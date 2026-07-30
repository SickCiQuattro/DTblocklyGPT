"""Control-flow safety regression tests (offline, no Gazebo/ROS/DB).

Run:
    poetry run python -m pytest testing/test_control_flow_gates.py -v

Covers a real crash-and-silently-truncate bug: `_h_when`/`_h_when_otherwise`
indexed `code["inputs"]["WHEN"]["block"]` unguarded. An unattached WHEN
condition serializes as `{}` (no "block" key) — reachable from a real,
isValid:true chat proposal (`condition: null` passes chat.py's validation)
or a hand-built block with an empty shadow slot. The resulting KeyError was
swallowed by the parser's own blanket `except Exception`, silently
truncating every step chained after the `when` while the run still reported
success — worse than a crash.

Also covers the matching `find_object_block` case: an unresolved OBJECT
input (`{}`, no "block" key) previously crashed `_log_condition`/
`_wait_for_condition` the same way.
"""
import sys
import os
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
from backend.block_types import EventsItems


@pytest.fixture(autouse=True)
def _reset_state():
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None
    yield
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None


def _notify_action(description):
    return {"type": "notify_action_block", "fields": {"TASK_DESC": description}}


def test_when_block_with_unattached_condition_does_not_crash_and_continues_chain(monkeypatch):
    """Regression: previously raised KeyError, swallowed silently, truncating
    the rest of the sequence while the run still reported success."""
    mock_bridge = MagicMock()
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    code = {
        "type": "when_block",
        "inputs": {"WHEN": {}, "DO": {}},
        "next": {"block": _notify_action("after the when")},
    }

    simulate.simulation_recursive_blockly_parser(code, [], [], [], simulate_event=True)

    assert not simulate.SIMULATION_STOP_EVENT.is_set()
    assert simulate._TASK_ABORT_REASON is None
    mock_bridge.notify.assert_any_call("/api/notify", {"description": "after the when"})


def test_when_block_with_unattached_condition_skips_do(monkeypatch):
    """No condition = not fulfilled, never "always run" — an ambiguous guard
    must never let a robot action execute."""
    mock_bridge = MagicMock()
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    code = {
        "type": "when_block",
        "inputs": {
            "WHEN": {},
            "DO": {"block": _notify_action("should not run")},
        },
    }

    simulate.simulation_recursive_blockly_parser(code, [], [], [], simulate_event=True)

    for call in mock_bridge.notify.call_args_list:
        assert call.args[1].get("description") != "should not run"


def test_when_otherwise_block_with_unattached_condition_does_not_crash(monkeypatch):
    mock_bridge = MagicMock()
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    code = {
        "type": "when_otherwise_block",
        "inputs": {"WHEN": {}, "DO": {}, "OTHERWISE": {}},
        "next": {"block": _notify_action("after the when-otherwise")},
    }

    simulate.simulation_recursive_blockly_parser(code, [], [], [], simulate_event=True)

    assert not simulate.SIMULATION_STOP_EVENT.is_set()
    mock_bridge.notify.assert_any_call("/api/notify", {"description": "after the when-otherwise"})


def test_find_object_with_unresolved_object_slot_does_not_crash(monkeypatch):
    """An empty OBJECT shadow slot (never filled in) must degrade to "not
    detected", not crash the auto-mode condition logger."""
    condition_block = {"type": EventsItems.FIND.value, "inputs": {"OBJECT": {}}}

    # Auto mode: _log_condition builds the label from the (missing) object data.
    result = simulate._log_condition(condition_block, simulate_event=True)
    assert result is True  # auto mode still reflects simulate_event once it doesn't crash

    # Live mode: _wait_for_condition must not raise either.
    mock_bridge = MagicMock()
    mock_bridge.get_vision_state.return_value = {"detections": [], "gesture": "NONE"}
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)

    result = simulate._wait_for_condition(condition_block, timeout=0.05)
    assert result is False
    assert simulate.SIMULATION_STOP_EVENT.is_set()  # find_object hard-aborts on timeout (by design)


# ─────────────────────────────────────────────────────────────────────────────
# Bare `when(condition, ...)` human-step-start/-complete (W: 2026-07-30)
# ─────────────────────────────────────────────────────────────────────────────
# Confirmed live: a bare when(gesture_detected) gave zero UI feedback for its
# whole timeout — only human_action blocks wrapped _eval_condition_tree with
# their own human-step-start/-complete; a bare `when` never did, so the
# operator's webcam turned on with nothing shown in the panel, and the STATUS
# line stayed frozen on "Starting simulation" the whole wait.

def test_when_block_live_condition_sends_human_step_start_and_complete(monkeypatch):
    mock_bridge = MagicMock()
    mock_bridge.get_vision_state.return_value = {"gesture": "THUMBS_UP", "gesture_age_s": 0.0}
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    condition_block = {
        "type": EventsItems.GESTURE.value,
        "fields": {"GESTURE_TYPE": "THUMBS_UP"},
    }
    code = {
        "type": "when_block",
        "inputs": {"WHEN": {"block": condition_block}, "DO": {"block": _notify_action("did it")}},
    }

    simulate.simulation_recursive_blockly_parser(code, [], [], [], simulate_event=False)

    mock_bridge.notify.assert_any_call(
        "/api/human-step-start",
        {"condition": "gesture", "value": "THUMBS_UP", "description": "",
         "timeout": simulate.CONDITION_TIMEOUT_S},
    )
    mock_bridge.notify.assert_any_call("/api/human-step-complete")


def test_when_block_auto_mode_does_not_send_human_step_events(monkeypatch):
    """Auto mode (simulate_event=True) resolves the condition instantly via
    _log_condition — sending 'started' there could leave the frontend stuck
    showing a wait that was never real (no guaranteed 'complete' when the
    condition resolves False)."""
    mock_bridge = MagicMock()
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    condition_block = {
        "type": EventsItems.GESTURE.value,
        "fields": {"GESTURE_TYPE": "THUMBS_UP"},
    }
    code = {
        "type": "when_block",
        "inputs": {"WHEN": {"block": condition_block}, "DO": {"block": _notify_action("did it")}},
    }

    simulate.simulation_recursive_blockly_parser(code, [], [], [], simulate_event=True)

    for call in mock_bridge.notify.call_args_list:
        assert call.args[0] not in ("/api/human-step-start", "/api/human-step-complete")


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
