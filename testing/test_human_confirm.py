"""Operator-confirm regression tests (no server, no browser — pure backend).

Run:
    poetry run python -m pytest testing/test_human_confirm.py -v

Covers the manual "Confirm" button — the human_feedback confirm modality for
human_action steps, added alongside gesture/voice/find_object/timer. Before
this, human_feedback was a chat-only pseudo-condition that always
auto-fulfilled (no Blockly block, no real wait). Same replay-safety pattern
as voice (testing/test_voice_command.py): freshness window, consume-on-read,
drain at step entry.
"""
import sys
import os
import time
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

try:
    import django
    django.setup()
except Exception:
    pass

from django.test import RequestFactory

from backend.functions import simulate
from backend.functions import vision_live
from backend.block_types import EventsItems


class _FakeUser:
    def __init__(self, authenticated=True):
        self.is_authenticated = authenticated


def _post_confirm(authenticated=True):
    request = RequestFactory().post("/api/human/confirm/")
    request.user = _FakeUser(authenticated)
    return vision_live.process_human_confirm(request)


@pytest.fixture(autouse=True)
def _reset_state():
    vision_live.reset_confirm()
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None
    yield
    vision_live.reset_confirm()
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None


# ── vision_live.get_confirm / reset_confirm ─────────────────────────────────

def test_get_confirm_fresh():
    vision_live._confirm_pending = True
    vision_live._confirm_time = time.monotonic()
    assert vision_live.get_confirm() is True


def test_get_confirm_expires_outside_window():
    vision_live._confirm_pending = True
    vision_live._confirm_time = time.monotonic() - 10.0
    assert vision_live.get_confirm(max_age_s=3.0) is False


def test_get_confirm_consume_clears_pending():
    vision_live._confirm_pending = True
    vision_live._confirm_time = time.monotonic()

    first = vision_live.get_confirm(consume=True)
    second = vision_live.get_confirm()

    assert first is True
    assert second is False


def test_get_confirm_no_consume_keeps_pending():
    vision_live._confirm_pending = True
    vision_live._confirm_time = time.monotonic()

    first = vision_live.get_confirm()
    second = vision_live.get_confirm()

    assert first is True
    assert second is True


def test_get_confirm_false_when_never_pressed():
    assert vision_live.get_confirm() is False


def test_reset_confirm_clears_pending():
    vision_live._confirm_pending = True
    vision_live._confirm_time = time.monotonic()

    vision_live.reset_confirm()

    assert vision_live.get_confirm() is False


# ── vision_live.process_human_confirm ───────────────────────────────────────

def test_process_human_confirm_sets_pending():
    resp = _post_confirm()
    assert resp.status_code == 200
    assert vision_live.get_confirm() is True


def test_process_human_confirm_requires_auth():
    resp = _post_confirm(authenticated=False)
    assert resp.status_code == 401
    assert vision_live.get_confirm() is False


def test_process_human_confirm_requires_post():
    request = RequestFactory().get("/api/human/confirm/")
    request.user = _FakeUser()
    resp = vision_live.process_human_confirm(request)
    assert resp.status_code == 405


# ── simulate._wait_for_condition (human_feedback) ───────────────────────────

def test_wait_for_confirm_pressed_returns_true(monkeypatch):
    """A press recorded during the wait (not before it) must satisfy it."""
    monkeypatch.setattr("backend.functions.vision_live.reset_confirm", MagicMock())
    monkeypatch.setattr(
        "backend.functions.vision_live.get_confirm", MagicMock(return_value=True)
    )

    condition_block = {"type": EventsItems.HUMAN_FEEDBACK.value}
    result = simulate._wait_for_condition(condition_block, timeout=1.0)

    assert result is True


def test_wait_for_confirm_timeout_does_not_abort(monkeypatch):
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)
    mock_bridge = MagicMock()
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    condition_block = {"type": EventsItems.HUMAN_FEEDBACK.value}
    result = simulate._wait_for_condition(condition_block, timeout=0.05)

    assert result is False
    assert not simulate.SIMULATION_STOP_EVENT.is_set()
    mock_bridge.notify.assert_any_call(
        "/api/human-step-timeout", {"condition": "human_feedback", "value": ""}
    )


def test_wait_for_confirm_drains_stale_press_before_waiting(monkeypatch):
    """A press recorded before the step started must not satisfy it —
    same replay class fixed on voice and gesture."""
    stale_press_time = time.monotonic()
    time.sleep(0.05)  # the step's reset_confirm() call happens after this
    vision_live._confirm_pending = True
    vision_live._confirm_time = stale_press_time
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)

    condition_block = {"type": EventsItems.HUMAN_FEEDBACK.value}
    result = simulate._wait_for_condition(condition_block, timeout=0.05)

    assert result is False


def test_wait_for_confirm_consumes_on_read(monkeypatch):
    """_wait_for_condition must read with consume=True, so one press can't
    satisfy more than one waiting step (mirrors the voice regression)."""
    monkeypatch.setattr("backend.functions.vision_live.reset_confirm", MagicMock())
    mock_get = MagicMock(return_value=True)
    monkeypatch.setattr("backend.functions.vision_live.get_confirm", mock_get)

    condition_block = {"type": EventsItems.HUMAN_FEEDBACK.value}
    simulate._wait_for_condition(condition_block, timeout=1.0)

    mock_get.assert_called_with(consume=True)


# ── simulate._h_human_action: unsatisfied confirm must abort the task ──────
# Regression: the return value of _eval_condition_tree(confirm_event) used to
# be discarded here — a confirm that timed out still fired human-step-complete
# and let the chain continue, exactly the failure a human confirm step exists
# to prevent (e.g. the seeded "Verify and store medicine" task would place a
# never-verified item).

def _human_action_block(confirm_event, next_block=None):
    code = {
        "type": "human_action_block",
        "fields": {"TASK_DESC": "Check the label and confirm"},
        "inputs": {"CONFIRM_EVENT": {"block": confirm_event}},
    }
    if next_block is not None:
        code["next"] = {"block": next_block}
    return code


def _notify_action(description):
    return {"type": "notify_action_block", "fields": {"TASK_DESC": description}}


def test_human_action_aborts_when_confirm_not_received(monkeypatch):
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)
    mock_bridge = MagicMock()
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)
    monkeypatch.setattr(simulate, "CONDITION_TIMEOUT_S", 0.05)

    code = _human_action_block(
        {"type": EventsItems.HUMAN_FEEDBACK.value},
        next_block=_notify_action("after the human action"),
    )
    simulate.simulation_recursive_blockly_parser(code, [], [], [], simulate_event=False)

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert simulate._TASK_ABORT_REASON is not None
    assert "didn't confirm in time" in simulate._TASK_ABORT_REASON
    # The chain must not continue past the unconfirmed step.
    notify_endpoints = [c.args[0] for c in mock_bridge.notify.call_args_list]
    descriptions = [
        c.args[1].get("description") for c in mock_bridge.notify.call_args_list
        if len(c.args) > 1 and isinstance(c.args[1], dict)
    ]
    assert "after the human action" not in descriptions
    assert "/api/human-step-complete" not in notify_endpoints


def test_human_action_proceeds_when_confirm_received(monkeypatch):
    monkeypatch.setattr("backend.functions.vision_live.reset_confirm", MagicMock())
    monkeypatch.setattr(
        "backend.functions.vision_live.get_confirm", MagicMock(return_value=True)
    )
    mock_bridge = MagicMock()
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    code = _human_action_block(
        {"type": EventsItems.HUMAN_FEEDBACK.value},
        next_block=_notify_action("after the human action"),
    )
    simulate.simulation_recursive_blockly_parser(code, [], [], [], simulate_event=False)

    assert not simulate.SIMULATION_STOP_EVENT.is_set()
    assert simulate._TASK_ABORT_REASON is None
    mock_bridge.notify.assert_any_call("/api/human-step-complete")
    mock_bridge.notify.assert_any_call(
        "/api/notify", {"description": "after the human action"}
    )


def test_human_action_aborts_when_voice_confirm_not_received(monkeypatch):
    """Same abort-on-unsatisfied-confirm rule for a different confirm modality
    — not just human_feedback."""
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)
    mock_bridge = MagicMock()
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)
    monkeypatch.setattr(simulate, "CONDITION_TIMEOUT_S", 0.05)

    code = _human_action_block({"type": EventsItems.VOICE.value, "fields": {"VOICE_WORD": "YES"}})
    simulate.simulation_recursive_blockly_parser(code, [], [], [], simulate_event=False)

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert simulate._TASK_ABORT_REASON is not None
    notify_endpoints = [c.args[0] for c in mock_bridge.notify.call_args_list]
    assert "/api/human-step-complete" not in notify_endpoints


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
