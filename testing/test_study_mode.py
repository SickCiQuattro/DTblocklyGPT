"""Regression tests for the user-study instrumentation and guards.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_study_mode.py -v

Three classes of defect made a user study unrunnable, because each of them
fabricates a successful operator confirmation that is indistinguishable, after
the fact, from one the participant actually performed:

  * the countdown shown to the operator was a hardcoded 60 while the deadline
    enforced was CONDITION_TIMEOUT_S (30) — the step gave up while the ring
    still showed half a minute left;
  * an unreachable vision bridge returned success for gesture and find_object
    (never for voice or button, so it biased two of the four channels);
  * an object already in frame satisfied find_object in 0 s, with no operator
    involvement at all.

STRICT_CONDITIONS turns the last two into failures. It is read at import time,
so these tests reload the module with the flag set rather than monkeypatching
the environment alone.
"""
import importlib
import json
import os
import sys
import tempfile
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

try:
    import django
    django.setup()
except Exception:
    pass

from backend.functions import simulate
from backend.functions import calibration
from backend.functions import env_utils


# ─── get_int_env ─────────────────────────────────────────────────────────────


def test_get_int_env_returns_default_when_unset(monkeypatch):
    monkeypatch.delenv("SOME_TIMEOUT", raising=False)
    assert env_utils.get_int_env("SOME_TIMEOUT", 30) == 30


def test_get_int_env_parses_value(monkeypatch):
    monkeypatch.setenv("SOME_TIMEOUT", "45")
    assert env_utils.get_int_env("SOME_TIMEOUT", 30) == 45


@pytest.mark.parametrize("raw", ["", "30s", "abc", "0", "-5"])
def test_get_int_env_falls_back_on_unusable_value(monkeypatch, raw):
    """A typo must not silently produce a step that expires instantly — that
    would read as an operator failure rather than a misconfiguration."""
    monkeypatch.setenv("SOME_TIMEOUT", raw)
    assert env_utils.get_int_env("SOME_TIMEOUT", 30) == 30


# ─── T1.1 timeout unification ────────────────────────────────────────────────


def test_human_step_start_timeout_matches_enforced_deadline():
    """The countdown the operator sees and the deadline the backend enforces
    must be the same number. They were 60 and 30."""
    source = open(
        os.path.join(os.path.dirname(__file__), "..", "backend", "functions", "simulate.py"),
        encoding="utf-8",
    ).read()
    assert '"timeout": 60' not in source, (
        "hardcoded 60 reintroduced in the human-step-start payload — it must "
        "carry CONDITION_TIMEOUT_S, the value _wait_for_condition enforces"
    )
    assert '"timeout": CONDITION_TIMEOUT_S' in source


def test_condition_timeout_is_env_overridable(monkeypatch):
    monkeypatch.setenv("HUMAN_STEP_TIMEOUT_S", "45")
    reloaded = importlib.reload(calibration)
    try:
        assert reloaded.CONDITION_TIMEOUT_S == 45
    finally:
        monkeypatch.delenv("HUMAN_STEP_TIMEOUT_S", raising=False)
        importlib.reload(calibration)


# ─── T1.3 / T3.2 STRICT_CONDITIONS ───────────────────────────────────────────


@pytest.fixture
def strict_simulate(monkeypatch):
    """simulate.py reloaded with STRICT_CONDITIONS on."""
    monkeypatch.setenv("STRICT_CONDITIONS", "1")
    mod = importlib.reload(simulate)
    assert mod.STRICT_CONDITIONS is True
    yield mod
    monkeypatch.delenv("STRICT_CONDITIONS", raising=False)
    importlib.reload(simulate)


def _gesture_block(gesture="THUMBS_UP"):
    from backend.block_types import EventsItems
    return {"type": EventsItems.GESTURE.value, "fields": {"GESTURE_TYPE": gesture}}


def _find_block(name="tube"):
    from backend.block_types import EventsItems
    return {
        "type": EventsItems.FIND.value,
        "inputs": {"OBJECT": {"block": {"data": json.dumps({"name": name})}}},
    }


def test_strict_gesture_aborts_when_bridge_unreachable(strict_simulate, monkeypatch):
    """A dead vision stack must not read as a successful confirmation."""
    import requests

    mod = strict_simulate
    mod.SIMULATION_STOP_EVENT.clear()
    mod._TASK_ABORT_REASON = None

    bridge = MagicMock()
    bridge.get_vision_state.side_effect = requests.exceptions.ConnectionError()
    monkeypatch.setattr(mod, "_bridge", bridge)

    result = mod._wait_for_condition(_gesture_block(), timeout=1)

    assert result is False
    assert mod._TASK_ABORT_REASON is not None

    mod.SIMULATION_STOP_EVENT.clear()
    mod._TASK_ABORT_REASON = None


def test_nonstrict_gesture_still_bypasses_when_bridge_unreachable(monkeypatch):
    """Default behaviour is unchanged: a developer with no camera can still
    run a task end-to-end."""
    import requests

    importlib.reload(simulate)
    assert simulate.STRICT_CONDITIONS is False
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None

    bridge = MagicMock()
    bridge.get_vision_state.side_effect = requests.exceptions.ConnectionError()
    monkeypatch.setattr(simulate, "_bridge", bridge)

    assert simulate._wait_for_condition(_gesture_block(), timeout=1) is True


def test_strict_find_object_requires_absent_then_present(strict_simulate, monkeypatch):
    """An object already in frame must not satisfy the step in 0 s: object
    presence is continuous, so only a transition proves the operator acted."""
    mod = strict_simulate
    mod.SIMULATION_STOP_EVENT.clear()
    mod._TASK_ABORT_REASON = None

    bridge = MagicMock()
    bridge.get_vision_state.return_value = {"detections": [{"class": "bottle"}]}
    monkeypatch.setattr(mod, "_bridge", bridge)
    monkeypatch.setattr(mod, "_detections_match", lambda *a, **k: True)
    monkeypatch.setattr(mod, "_interruptible_sleep", lambda *_a, **_k: None)

    # Always present, never absent → must NOT confirm, must time out.
    assert mod._wait_for_condition(_find_block(), timeout=1) is False

    mod.SIMULATION_STOP_EVENT.clear()
    mod._TASK_ABORT_REASON = None


def test_nonstrict_find_object_confirms_immediately_when_present(monkeypatch):
    """Default behaviour unchanged: already-visible object resumes the task."""
    importlib.reload(simulate)
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None

    bridge = MagicMock()
    bridge.get_vision_state.return_value = {"detections": [{"class": "bottle"}]}
    monkeypatch.setattr(simulate, "_bridge", bridge)
    monkeypatch.setattr(simulate, "_detections_match", lambda *a, **k: True)

    assert simulate._wait_for_condition(_find_block(), timeout=1) is True


# ─── T2.1 study log ──────────────────────────────────────────────────────────


def test_study_log_is_noop_without_path(monkeypatch):
    monkeypatch.delenv("STUDY_LOG_PATH", raising=False)
    from backend.functions import study_log

    reloaded = importlib.reload(study_log)
    assert reloaded.is_enabled() is False
    reloaded.log_event("anything", a=1)  # must not raise


def test_study_log_writes_one_json_object_per_event(monkeypatch):
    from backend.functions import study_log

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "P01.jsonl")
        monkeypatch.setenv("STUDY_LOG_PATH", path)
        monkeypatch.setenv("STUDY_PARTICIPANT_ID", "P01")
        reloaded = importlib.reload(study_log)
        assert reloaded.is_enabled() is True

        reloaded.log_event("human_step_start", condition="voice", value="YES")
        reloaded.log_event("attempt", channel="voice", value="NO", accepted=True)
        reloaded.log_event("human_step_end", condition="voice", outcome="confirmed")

        rows = [json.loads(line) for line in open(path, encoding="utf-8")]

    assert [r["kind"] for r in rows] == [
        "human_step_start", "attempt", "human_step_end",
    ]
    assert all(r["participant"] == "P01" for r in rows)
    # Durations must come from the monotonic clock: the wall clock can jump
    # backwards mid-session and produce negative confirmation times.
    assert all("t_mono" in r for r in rows)
    assert rows[1]["accepted"] is True

    monkeypatch.delenv("STUDY_LOG_PATH", raising=False)
    monkeypatch.delenv("STUDY_PARTICIPANT_ID", raising=False)
    importlib.reload(study_log)


def test_study_log_survives_unwritable_path(monkeypatch):
    """A logging failure must never abort a participant's run."""
    from backend.functions import study_log

    monkeypatch.setenv("STUDY_LOG_PATH", "/nonexistent-dir-xyz/out.jsonl")
    reloaded = importlib.reload(study_log)
    reloaded.log_event("human_step_start")  # must not raise

    monkeypatch.delenv("STUDY_LOG_PATH", raising=False)
    importlib.reload(study_log)


# ─── Attempt counting across channels ────────────────────────────────────────


def test_gesture_logs_one_attempt_per_transition(monkeypatch):
    """Gesture is polled, not posted, so without transition logging this channel
    has no attempt count at all and cannot be compared with voice or button."""
    importlib.reload(simulate)
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None

    # Held across polls: FIST (wrong, held 2 polls), then THUMBS_UP (right).
    # The held FIST must produce ONE attempt, not one per poll.
    samples = [
        {"gesture": "FIST", "gesture_age_s": 0.0},
        {"gesture": "FIST", "gesture_age_s": 0.0},
        {"gesture": "THUMBS_UP", "gesture_age_s": 0.0},
    ]
    bridge = MagicMock()
    bridge.get_vision_state.side_effect = list(samples) + [samples[-1]] * 20
    monkeypatch.setattr(simulate, "_bridge", bridge)
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda *_a, **_k: None)

    logged = []
    monkeypatch.setattr(
        simulate.study_log,
        "log_event",
        lambda kind, **f: logged.append({"kind": kind, **f}),
    )

    assert simulate._wait_for_condition(_gesture_block("THUMBS_UP"), timeout=5) is True

    attempts = [e for e in logged if e["kind"] == "attempt"]
    assert [(a["value"], a["accepted"]) for a in attempts] == [
        ("FIST", False),
        ("THUMBS_UP", True),
    ]
    assert all(a["channel"] == "gesture" for a in attempts)


def test_gesture_ignores_none_and_repeats(monkeypatch):
    """'NONE' is the absence of a gesture, not an attempt at one."""
    importlib.reload(simulate)
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None

    bridge = MagicMock()
    bridge.get_vision_state.side_effect = [
        {"gesture": "NONE", "gesture_age_s": 0.0},
        {"gesture": "NONE", "gesture_age_s": 0.0},
        {"gesture": "THUMBS_UP", "gesture_age_s": 0.0},
    ] + [{"gesture": "THUMBS_UP", "gesture_age_s": 0.0}] * 20
    monkeypatch.setattr(simulate, "_bridge", bridge)
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda *_a, **_k: None)

    logged = []
    monkeypatch.setattr(
        simulate.study_log,
        "log_event",
        lambda kind, **f: logged.append({"kind": kind, **f}),
    )

    assert simulate._wait_for_condition(_gesture_block("THUMBS_UP"), timeout=5) is True

    attempts = [e for e in logged if e["kind"] == "attempt"]
    assert len(attempts) == 1
    assert attempts[0]["value"] == "THUMBS_UP"


# ─── analisi.py ──────────────────────────────────────────────────────────────


def _load_analisi():
    """Import the analysis script by path — it lives outside the package."""
    import importlib.util

    path = os.path.join(
        os.path.dirname(__file__), "..", "studio-utenti", "analisi.py"
    )
    spec = importlib.util.spec_from_file_location("analisi", path)
    assert spec is not None and spec.loader is not None, f"non caricabile: {path}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _event(kind, t, **fields):
    return {"kind": kind, "participant": "P01", "t_mono": t, **fields}


def test_analisi_segments_runs_and_measures_condition():
    analisi = _load_analisi()
    events = [
        _event("run_start", 100.0, task_id=1, task_name="PB-B-voce",
               target="sim", simulate_event=False),
        _event("human_step_start", 101.0, condition="voice", value="DONE"),
        _event("attempt", 102.0, channel="voice", value="YES", accepted=False),
        _event("attempt", 103.0, channel="voice", value="DONE", accepted=True),
        _event("human_step_end", 104.0, condition="voice", outcome="confirmed"),
        _event("run_end", 105.0, task_id=1, task_name="PB-B-voce", outcome="completed"),
    ]
    runs = analisi.segment_runs(events)
    assert len(runs) == 1
    assert len(runs[0]["events"]) == 4
    assert analisi.duration(runs[0]["start"], runs[0]["end"]) == 5.0
    # step duration, not run duration — the confirmation is what is measured
    assert analisi.duration(events[1], events[4]) == 3.0


def test_analisi_ignores_attempts_outside_the_waiting_window(tmp_path):
    """The button and voice endpoints log every press and every recognised word,
    including ones made before the robot reached the step. Counting those would
    inflate the attempt count for the channels where acting early is easiest."""
    analisi = _load_analisi()
    rows = [
        _event("run_start", 10.0, task_id=1, task_name="PB-A-pulsante",
               target="sim", simulate_event=False),
        # Pressed while the arm was still moving, before the step opened.
        _event("attempt", 11.0, channel="human_feedback", accepted=True),
        _event("human_step_start", 12.0, condition="human_feedback", value=""),
        _event("attempt", 13.0, channel="human_feedback", accepted=True),
        _event("human_step_end", 14.0, condition="human_feedback", outcome="confirmed"),
        # Pressed again after the step had already resolved.
        _event("attempt", 15.0, channel="human_feedback", accepted=True),
        _event("run_end", 16.0, task_id=1, task_name="PB-A-pulsante", outcome="completed"),
    ]
    path = tmp_path / "P01.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")

    conditions, _, _ = analisi.analyse_participant(path)

    assert conditions[0]["tentativi"] == 1, "solo il tentativo dentro la finestra"
    assert conditions[0]["primo_tentativo"] == "SI"


def test_analisi_attributes_nothing_without_step_boundaries(tmp_path):
    """A run that died before the step opened has no window: attributing every
    stray attempt to it would invent a measure."""
    analisi = _load_analisi()
    rows = [
        _event("run_start", 10.0, task_id=1, task_name="PB-B-voce",
               target="sim", simulate_event=False),
        _event("attempt", 11.0, channel="voice", value="DONE", accepted=True),
        _event("run_end", 12.0, task_id=1, task_name="PB-B-voce", outcome="aborted"),
    ]
    path = tmp_path / "P01.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")

    conditions, _, _ = analisi.analyse_participant(path)

    assert conditions[0]["tentativi"] == 0
    assert conditions[0]["tempo_s"] is None


def test_analisi_leaves_find_object_attempts_undefined(tmp_path):
    """D sends no operator signal: attempts must be empty, never 0 or 1."""
    analisi = _load_analisi()
    rows = [
        _event("run_start", 10.0, task_id=1, task_name="PB-D-oggetto",
               target="sim", simulate_event=False),
        _event("human_step_start", 11.0, condition="object", value="tube"),
        _event("human_step_end", 14.0, condition="object", outcome="confirmed"),
        _event("run_end", 15.0, task_id=1, task_name="PB-D-oggetto", outcome="completed"),
    ]
    path = tmp_path / "P01.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")

    conditions, _, _ = analisi.analyse_participant(path)

    assert len(conditions) == 1
    assert conditions[0]["condizione"] == "D_oggetto"
    assert conditions[0]["tentativi"] == ""
    assert conditions[0]["primo_tentativo"] == ""
    assert conditions[0]["tempo_s"] == 3.0


def test_analisi_flags_auto_mode_runs(tmp_path):
    """A run in auto mode confirmed itself — it must be flagged, not counted."""
    analisi = _load_analisi()
    rows = [
        _event("run_start", 10.0, task_id=1, task_name="PB-A-pulsante",
               target="sim", simulate_event=True),
        _event("human_step_start", 11.0, condition="human_feedback", value=""),
        _event("human_step_end", 11.5, condition="human_feedback", outcome="confirmed"),
        _event("run_end", 12.0, task_id=1, task_name="PB-A-pulsante", outcome="completed"),
    ]
    path = tmp_path / "P01.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")

    conditions, runs, _ = analisi.analyse_participant(path)

    assert conditions[0]["AUTO_DA_SCARTARE"] == "SI"
    assert runs[0]["AUTO_DA_SCARTARE"] == "SI"


def test_analisi_survives_truncated_line(tmp_path, capsys):
    """A half-written final line is what stopping the server mid-write leaves."""
    analisi = _load_analisi()
    path = tmp_path / "P01.jsonl"
    path.write_text(
        json.dumps(_event("run_start", 1.0, task_id=1, task_name="X", target="sim"))
        + "\n{ TRONCATO\n",
        encoding="utf-8",
    )

    _, runs, _ = analisi.analyse_participant(path)

    assert len(runs) == 1  # the good line still parsed
    assert "illeggibile" in capsys.readouterr().err


def test_analisi_bootstrap_needs_three_observations():
    analisi = _load_analisi()
    assert analisi.bootstrap_ci([1.0, 2.0]) is None
    low, high = analisi.bootstrap_ci([1.0, 2.0, 3.0, 4.0, 5.0])
    assert low <= 3.0 <= high


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
