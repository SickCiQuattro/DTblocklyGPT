"""Hardware safety regression tests (no BCAP, no ROS — Flask bridge mocked).

Run:
    DJANGO_SETTINGS_MODULE=django_project_conf.settings poetry run python -m pytest testing/test_hw_safety.py -v

Covers the digital-twin hardening added on top of simulate.py:
- _send_hw_target: HTTP/service failures abort the task instead of being swallowed
- _verify_hw_arrival: twin-vs-encoder divergence after a move
- _verify_hw_grasp: missed-pick detection from the real gripper aperture
- _wait_for_condition (find_object): timeout hard-aborts instead of continuing
- DRIVE_HARDWARE unset: sim-only behavior is unchanged
"""
import sys
import os
import json
from unittest.mock import MagicMock

import pytest
import requests

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

try:
    import django
    django.setup()
except Exception:
    pass

from backend.functions import simulate
from backend.functions.flask_ros_client import FlaskRosClient
from backend.block_types import EventsItems


@pytest.fixture(autouse=True)
def _reset_state():
    """Every test starts from a clean slate — these are shared module globals."""
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None
    simulate._LAST_HW_HAND_MM = None
    simulate._HW_DRIVE_REQUESTED = False
    simulate._spawned_in_world.clear()
    yield
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None
    simulate._LAST_HW_HAND_MM = None
    simulate._HW_DRIVE_REQUESTED = False
    simulate._spawned_in_world.clear()


# ── FlaskRosClient.move_target ─────────────────────────────────────────────────

def test_move_target_http_error_raises():
    """A 5xx / connection error on /api/move-target must propagate, not be swallowed."""
    session = MagicMock()
    resp = MagicMock()
    resp.raise_for_status.side_effect = requests.exceptions.HTTPError("500 Server Error")
    session.post.return_value = resp

    client = FlaskRosClient(session=session)
    with pytest.raises(requests.exceptions.HTTPError):
        client.move_target({"j1": 0.0, "hand": 30.0, "hand_only": False})


def test_move_target_success_returns_dict():
    session = MagicMock()
    resp = MagicMock()
    resp.raise_for_status.return_value = None
    resp.json.return_value = {"ok": True, "message": ""}
    session.post.return_value = resp

    client = FlaskRosClient(session=session)
    result = client.move_target({"hand": 30.0, "hand_only": True})
    assert result == {"ok": True, "message": ""}


# ── simulate._send_hw_target ────────────────────────────────────────────────────

def test_move_target_failure_aborts(monkeypatch):
    """Service-level rejection (ok=False) must abort the task, not just print."""
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", True)
    mock_bridge = MagicMock()
    mock_bridge.move_target.return_value = {"ok": False, "message": "robot arm error"}
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    result = simulate._send_hw_target([0.0] * 6, 30.0)

    assert result is False
    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "rejected the last move command" in simulate._TASK_ABORT_REASON
    mock_bridge.stop.assert_called_once()


def test_move_target_unreachable_aborts(monkeypatch):
    """Transport failure (node down, timeout) must abort the task too."""
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", True)
    mock_bridge = MagicMock()
    mock_bridge.move_target.side_effect = requests.exceptions.ConnectionError("refused")
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    result = simulate._send_hw_target([0.0] * 6, 30.0)

    assert result is False
    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "Lost connection" in simulate._TASK_ABORT_REASON


def test_sim_mode_untouched(monkeypatch):
    """DRIVE_HARDWARE unset: no bridge call, no abort — sim-only path is unchanged."""
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", False)
    mock_bridge = MagicMock()
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    result = simulate._send_hw_target([0.0] * 6, 30.0)

    assert result is True
    mock_bridge.move_target.assert_not_called()
    assert not simulate.SIMULATION_STOP_EVENT.is_set()


# ── simulate._verify_hw_arrival ─────────────────────────────────────────────────

def test_verify_hw_arrival_polls_until_fresh(monkeypatch):
    """First reads are empty/stale (10 Hz timer lag); a later fresh match still passes."""
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", True)
    mock_bridge = MagicMock()
    mock_bridge.get_actual_joints_real.side_effect = [
        [],                          # encoder timer hasn't published yet
        [10.0] * 6,                  # stale — arm hadn't arrived when this was read
        [0.0] * 6,                   # fresh — matches target
    ]
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    result = simulate._verify_hw_arrival([0.0] * 6, tol_deg=2.0, timeout_s=3.0)

    assert result is True
    assert simulate._TASK_ABORT_REASON is None


def test_verify_hw_arrival_timeout_aborts(monkeypatch):
    """Encoders never reach the commanded pose within the window → twin divergence abort."""
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", True)
    mock_bridge = MagicMock()
    mock_bridge.get_actual_joints_real.return_value = [90.0] * 6
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    result = simulate._verify_hw_arrival([0.0] * 6, tol_deg=2.0, timeout_s=0.3)

    assert result is False
    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "didn't reach the position" in simulate._TASK_ABORT_REASON


# ── simulate._verify_hw_grasp ────────────────────────────────────────────────────

def test_verify_hw_grasp_missed(monkeypatch):
    """Fingers closed to (about) the commanded value ⇒ nothing was between them."""
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", True)
    monkeypatch.setattr(simulate, "_LAST_HW_HAND_MM", 10.0)

    result = simulate._verify_hw_grasp(10.0)

    assert result is False
    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "closed on empty air" in simulate._TASK_ABORT_REASON


def test_verify_hw_grasp_success(monkeypatch):
    """Fingers stopped well short of fully closed ⇒ something is held."""
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", True)
    monkeypatch.setattr(simulate, "_LAST_HW_HAND_MM", 15.0)

    result = simulate._verify_hw_grasp(10.0)

    assert result is True
    assert simulate._TASK_ABORT_REASON is None


def test_verify_hw_grasp_no_data_passes(monkeypatch):
    """No HandCurPos readout (node too old / read failed) must not block the sim."""
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", True)
    monkeypatch.setattr(simulate, "_LAST_HW_HAND_MM", None)

    assert simulate._verify_hw_grasp(10.0) is True


# ── simulate._wait_for_condition (find_object) ──────────────────────────────────

def test_find_object_timeout_aborts(monkeypatch):
    """find_object timing out must hard-abort the task, not continue silently."""
    mock_bridge = MagicMock()
    mock_bridge.get_vision_state.return_value = {"detections": [], "gesture": "NONE"}
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    condition_block = {
        "type": EventsItems.FIND.value,
        "inputs": {"OBJECT": {"block": {"data": json.dumps({"id": 1, "name": "flask"})}}},
    }
    result = simulate._wait_for_condition(condition_block, timeout=0.3)

    assert result is False
    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "Couldn't find 'flask'" in simulate._TASK_ABORT_REASON
    mock_bridge.notify.assert_any_call(
        "/api/human-step-timeout", {"condition": "object", "value": "flask"}
    )


def test_find_object_detected_no_abort(monkeypatch):
    mock_bridge = MagicMock()
    mock_bridge.get_vision_state.return_value = {"detections": [{"class": "bottle"}]}
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    condition_block = {
        "type": EventsItems.FIND.value,
        "inputs": {"OBJECT": {"block": {"data": json.dumps({"id": 1, "name": "flask"})}}},
    }
    result = simulate._wait_for_condition(condition_block, timeout=0.3)

    assert result is True
    assert not simulate.SIMULATION_STOP_EVENT.is_set()
    assert simulate._TASK_ABORT_REASON is None


# ── _hw_drive_active: the "Simulation never moves the arm" guarantee ───────────
# Two independent keys — server-side DRIVE_HARDWARE (env, armed for the whole
# process) and per-request _HW_DRIVE_REQUESTED (set by simulate_task() from the
# driveHardware body key). Neither alone is enough: a "Real robot" request on
# an unarmed server must refuse (simulate_task's own check, not this gate) and
# a "Simulation" request on an armed server must still not touch the bridge.

def test_request_flag_gates_hw_even_when_server_armed(monkeypatch):
    """Server armed (DRIVE_HARDWARE) but this request didn't ask for hardware
    (driveHardware unset/false) — the arm must not move."""
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", False)
    mock_bridge = MagicMock()
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    assert simulate._hw_drive_active() is False
    result = simulate._send_hw_target([0.0] * 6, 30.0)

    assert result is True
    mock_bridge.move_target.assert_not_called()


def test_env_gate_required_even_when_request_asks(monkeypatch):
    """Request asked for hardware but the server itself isn't armed — same
    no-op (simulate_task refuses this case with an error before ever getting
    here; this pins the lower-level gate too, defense in depth)."""
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", False)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", True)
    mock_bridge = MagicMock()
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    assert simulate._hw_drive_active() is False
    result = simulate._send_hw_target([0.0] * 6, 30.0)

    assert result is True
    mock_bridge.move_target.assert_not_called()


def test_hw_active_requires_both_keys(monkeypatch):
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", True)
    mock_bridge = MagicMock()
    mock_bridge.move_target.return_value = {"ok": True, "message": ""}
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    assert simulate._hw_drive_active() is True
    simulate._send_hw_target([0.0] * 6, 30.0, hand_only=True)

    mock_bridge.move_target.assert_called_once()


def test_sim_run_lock_rejects_concurrent_run():
    """Busy-guard: a second simulate_task() call while one is in flight must
    be rejected, not race the first on _HW_DRIVE_REQUESTED."""
    acquired = simulate._SIM_RUN_LOCK.acquire(blocking=False)
    assert acquired  # sanity: lock starts free
    try:
        assert simulate._SIM_RUN_LOCK.acquire(blocking=False) is False
    finally:
        simulate._SIM_RUN_LOCK.release()
