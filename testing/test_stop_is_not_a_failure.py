"""Guard: pressing Stop must not be reported to the operator as a fault.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_stop_is_not_a_failure.py -v

Stopping mid-motion makes every safety gate in simulate.py true at once: the
arm does not reach where it was told, the object does not rise with it, the
twin diverges from its target. Each of those calls `_abort_task`, and the
operator was shown a technical failure for doing exactly what the Stop button
is for. Reported 2026-09-03 — "giustamente il braccio non è arrivato alla
provetta perchè ho terminato simulazione, ma proprio per questo non dovrebbe
uscirmi un errore".

The same run also logged `Internal Server Error: /api/task/simulate/` on every
Stop, because a deliberate operator action returned 500.

The rule both fix: **a consequence of stopping is not a fault, and a fault
that happened BEFORE the stop still is.** That second half is what stops this
from becoming a blanket "ignore errors while stopping": a genuine failure sets
its reason before setting the stop event, so it cannot be mistaken for
fallout, and a later Stop cannot overwrite it.
"""
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

try:
    import django
    django.setup()
except Exception:
    pass

from backend.functions import simulate  # noqa: E402

SIMULATE = os.path.join(
    os.path.dirname(__file__), "..", "backend", "functions", "simulate.py"
)


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    monkeypatch.setattr(simulate, "_bridge", type("B", (), {
        "stop": staticmethod(lambda: True),
        "notify": staticmethod(lambda *a, **k: True),
    })())
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None
    yield
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None


def test_a_gate_that_fires_because_of_the_stop_records_nothing():
    """The operator pressed Stop; the arm then failed to arrive. That is the
    Stop working, not a fault to report."""
    simulate.SIMULATION_STOP_EVENT.set()          # operator pressed Stop
    simulate._abort_task("The robot arm didn't reach the position.",
                         detail="hw arrival check after stop")
    assert simulate._TASK_ABORT_REASON is None, (
        "una conseguenza dello Stop viene ancora riportata come guasto: "
        "l'operatore vede un errore tecnico per aver premuto Stop."
    )


def test_a_real_fault_before_the_stop_is_kept():
    """The half that keeps this from being 'ignore errors while stopping'."""
    simulate._abort_task("Couldn't pick up 'blue tube'.", detail="real fault")
    assert simulate._TASK_ABORT_REASON == "Couldn't pick up 'blue tube'."
    # _abort_task sets the event itself; a gate firing afterwards must not
    # erase the reason that is already claimed.
    simulate._abort_task("The robot arm didn't reach the position.")
    assert simulate._TASK_ABORT_REASON == "Couldn't pick up 'blue tube'.", (
        "un guasto reale viene sovrascritto o cancellato dalla ricaduta che "
        "esso stesso ha provocato."
    )


def test_a_stop_is_not_an_internal_server_error():
    src = open(SIMULATE, encoding="utf-8").read()
    branch = src[src.index('outcome = "stopped"'):]
    branch = branch[:branch.index("return") + 200]
    assert "status=409" in branch, (
        "una corsa fermata dall'operatore torna a rispondere 500: Django la "
        "registra come 'Internal Server Error' nella stessa console dove va "
        "individuato un guasto vero."
    )


def test_silence_from_the_state_topic_is_not_a_refusal():
    """That topic publishes on CHANGE. An empty read window means the plugin
    said nothing, which is not the same as saying 'detached' — and treating it
    as failure aborted the first pick of a session after ten identical
    retries. The lift check is the verdict now."""
    body = open(SIMULATE, encoding="utf-8").read()
    fn = body[body.index("def attach_object_to_gripper"):]
    fn = fn[:fn.index("\ndef ")]
    fn_code = re.sub(r'"""[\s\S]*?"""', "", fn)
    assert "if not out.strip():" in fn_code, (
        "un silenzio del topic di stato torna a contare come rifiuto: la "
        "prima presa di una sessione abortisce dopo dieci tentativi identici."
    )
    ok_at = fn_code.index("if not out.strip():")
    assert "return True" in fn_code[ok_at:ok_at + 300], (
        "il ramo del silenzio non prosegue piu': serve lasciare decidere "
        "_verify_sim_grasp, che guarda l'oggetto salire davvero."
    )


def test_the_weld_failure_message_states_the_real_attempt_count():
    src = open(SIMULATE, encoding="utf-8").read()
    assert "(2 attempts)" not in src, (
        "il messaggio di weld fallito dichiara di nuovo un numero di "
        "tentativi fisso che non corrisponde a _ATTACH_MAX_ATTEMPTS."
    )


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
