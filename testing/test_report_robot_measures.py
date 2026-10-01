"""The robot-measurement report reads what the backend writes (offline).

The report and the three log lines it consumes (`step`, `hw_arrival`, `hw_grasp`)
are written in different files, and a rename on either side would produce an
empty table rather than an error. This builds a log with the real writer and
feeds it to the real reader.
"""
import importlib.util
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")
try:
    import django
    django.setup()
except Exception:
    pass

from backend.functions import study_log  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "report_robot_measures", os.path.join(os.path.dirname(__file__), "report_robot_measures.py"))
rep = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rep)


@pytest.fixture
def log(tmp_path, monkeypatch):
    p = tmp_path / "misure.jsonl"
    monkeypatch.setattr(study_log, "_LOG_PATH", str(p))
    return p


def _run(target, task, blocks, outcome="completed", reason=None):
    study_log.log_event("run_start", task_name=task, target=target, simulate_event=False)
    for b in blocks:
        study_log.log_event("step", block=b, block_id="x", target=target, depth=0)
    study_log.log_event("run_end", task_name=task, outcome=outcome, abort_reason=reason)


def test_same_task_on_both_targets_is_compared_step_by_step(log, capsys):
    _run("sim", "T", ["pick_block", "human_action_block", "place_block"])
    _run("real", "T", ["pick_block", "human_action_block", "place_block"])
    _run("sim", "U", ["pick_block", "place_block"])
    _run("real", "U", ["pick_block"], outcome="aborted", reason="The gripper closed on empty air")

    runs = rep.cicli(rep.carica(str(log)))
    rep.sez_corrispondenza(runs)
    out = capsys.readouterr().out

    assert "| T | 1 | 1 | sì (3/3) | sì (completed/completed) |" in out
    assert "| U | 1 | 1 | NO (2/1) | NO (completed/aborted) | passo 2: sim place_block, robot fine |" in out
    assert rep.classifica("The gripper closed on empty air") == "presa a vuoto rilevata"
    assert rep.classifica("weird") == "da classificare a mano"


def test_the_grasp_table_says_whether_the_threshold_separates(log, capsys):
    for w in (17.9, 18.1, 14.3, 17.8, 14.6):   # 3 held, 2 closed on air (positions 3 and 5)
        study_log.log_event("hw_grasp", hand_mm=w, commanded_mm=14.0, tol_mm=1.5,
                            margin_mm=round(w - 14.0, 3), empty=w <= 15.5)

    rep.sez_prese(rep.carica(str(log)), {3, 5})
    out = capsys.readouterr().out

    assert "con la provetta**: n=3" in out and "a vuoto**: n=2" in out
    assert "la soglia 1.5 mm separa i due gruppi" in out


def test_an_overlap_is_reported_as_no_separation(log, capsys):
    for w in (16.0, 15.6):    # an empty grasp reading wider than a held one
        study_log.log_event("hw_grasp", hand_mm=w, commanded_mm=14.0, tol_mm=1.5,
                            margin_mm=round(w - 14.0, 3), empty=False)
    rep.sez_prese(rep.carica(str(log)), {1})
    assert "NON separa" in capsys.readouterr().out


def test_arrival_summary_reads_the_real_writer_output(log, capsys):
    from backend.functions import simulate
    simulate._log_hw_arrival([0.0] * 6, [0.2, 0.1, 0.0, 0.0, 0.3, 0.0], 2.0, 1, 0.0, True)
    simulate._log_hw_arrival([0.0] * 6, [0.9, 0.1, 0.0, 0.0, 0.0, 0.0], 2.0, 3, 0.0, True)

    rep.sez_arrivi(rep.carica(str(log)))
    out = capsys.readouterr().out

    assert "2 arrivi, soglia 2°" in out and "massimo 0.900°" in out
    assert json.loads(log.read_text().splitlines()[0])["kind"] == "hw_arrival"


def test_stop_latency_is_summarised_from_the_backend_lines(log, capsys):
    study_log.log_event("stop_requested", hardware=True)
    study_log.log_event("stop_done", elapsed_s=0.21, hardware_halt_ok=True, warning=False)
    study_log.log_event("stop_done", elapsed_s=0.35, hardware_halt_ok=True, warning=False)
    rep.sez_arresti(rep.carica(str(log)))
    out = capsys.readouterr().out
    assert "2 arresti" in out and "massimo 0.350 s" in out and "Halt confermato dal braccio: 2" in out
