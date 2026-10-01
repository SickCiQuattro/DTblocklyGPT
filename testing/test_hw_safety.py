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


# ── FlaskRosClient.move_path: retry must not replay an already-accepted
# trajectory (W2.2) ──────────────────────────────────────────────────────────

def test_move_path_retries_on_connection_error():
    """The request never reached the server — safe to retry."""
    session = MagicMock()
    ok_resp = MagicMock()
    ok_resp.raise_for_status.return_value = None
    session.post.side_effect = [requests.exceptions.ConnectionError("refused"), ok_resp]

    client = FlaskRosClient(session=session)
    client.move_path([{"j1": 0.0}])  # must not raise

    assert session.post.call_count == 2


def test_move_path_does_not_retry_on_read_timeout():
    """A read timeout means the server may already have started the
    trajectory — retrying would replay a real robot motion, so this must
    raise immediately instead of resubmitting."""
    session = MagicMock()
    session.post.side_effect = requests.exceptions.ReadTimeout("timed out")

    client = FlaskRosClient(session=session)
    with pytest.raises(requests.exceptions.ReadTimeout):
        client.move_path([{"j1": 0.0}])

    assert session.post.call_count == 1


def test_move_path_does_not_retry_on_http_error():
    """A 4xx/5xx from raise_for_status is a definite server-side outcome —
    also not a transport failure, so also not retried."""
    session = MagicMock()
    resp = MagicMock()
    resp.raise_for_status.side_effect = requests.exceptions.HTTPError("500")
    session.post.return_value = resp

    client = FlaskRosClient(session=session)
    with pytest.raises(requests.exceptions.HTTPError):
        client.move_path([{"j1": 0.0}])

    assert session.post.call_count == 1


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


# ── No confirmation is ever assumed on the real arm ───────────────────────────
# With STRICT_CONDITIONS off (the default), an unreachable vision bridge, a
# stopped vision_node or an object already in frame all resolve a human step by
# themselves, so a developer without a camera can run a task in the twin. On
# the real arm that meant the physical robot carried on to the next move on a
# confirmation nobody gave. Driving hardware now forces the strict policy.

def _gesture():
    from backend.block_types import EventsItems
    return {"type": EventsItems.GESTURE.value, "fields": {"GESTURE_TYPE": "THUMBS_UP"}}


def _find():
    from backend.block_types import EventsItems
    return {"type": EventsItems.FIND.value,
            "inputs": {"OBJECT": {"block": {"data": json.dumps({"name": "tube"})}}}}


@pytest.fixture
def real_arm_not_strict(monkeypatch):
    monkeypatch.setattr(simulate, "STRICT_CONDITIONS", False)
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", True)
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda *_a, **_k: None)
    monkeypatch.setattr(simulate, "_abort_task",
                        lambda msg, detail=None: setattr(simulate, "_TASK_ABORT_REASON", msg))
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None
    yield
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None


def test_real_arm_does_not_bypass_a_gesture_when_the_bridge_is_down(real_arm_not_strict, monkeypatch):
    bridge = MagicMock()
    bridge.get_vision_state.side_effect = requests.exceptions.ConnectionError()
    monkeypatch.setattr(simulate, "_bridge", bridge)

    assert simulate._wait_for_condition(_gesture(), timeout=1) is False
    assert simulate._TASK_ABORT_REASON, "must abort, not resume on an assumed gesture"


def test_real_arm_does_not_simulate_a_detection_when_vision_node_is_stopped(real_arm_not_strict, monkeypatch):
    """The realistic case: bridge and arm alive, object detector dead. In the
    twin this is a "simulated" success; on the real arm it must stop."""
    bridge = MagicMock()
    bridge.get_vision_state.return_value = {
        "detections": [], "object_age_s": simulate.VISION_STALE_AFTER_S + 60}
    monkeypatch.setattr(simulate, "_bridge", bridge)

    assert simulate._wait_for_condition(_find(), timeout=1) is False
    assert simulate._TASK_ABORT_REASON


def test_real_arm_ignores_an_object_already_in_frame(real_arm_not_strict, monkeypatch):
    """Presence is continuous: only absent-then-present proves someone acted."""
    bridge = MagicMock()
    bridge.get_vision_state.return_value = {"detections": [{"class": "bottle"}]}
    monkeypatch.setattr(simulate, "_bridge", bridge)
    monkeypatch.setattr(simulate, "_detections_match", lambda *a, **k: True)

    assert simulate._wait_for_condition(_find(), timeout=1) is False


def test_the_twin_alone_stays_permissive(monkeypatch):
    """Unchanged on purpose: without the arm nothing physical moves, and a
    developer with no camera must still be able to run a task end to end."""
    monkeypatch.setattr(simulate, "STRICT_CONDITIONS", False)
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", False)
    simulate.SIMULATION_STOP_EVENT.clear()
    bridge = MagicMock()
    bridge.get_vision_state.side_effect = requests.exceptions.ConnectionError()
    monkeypatch.setattr(simulate, "_bridge", bridge)

    assert simulate._strict_conditions() is False
    assert simulate._wait_for_condition(_gesture(), timeout=1) is True


def test_server_refuses_automatic_confirmations_on_the_real_arm(monkeypatch):
    """The panel forces 'live' on the real-robot target, but the server is the
    trust boundary: simulateEvent + driveHardware would carry the physical arm
    through every human step with nobody confirming."""
    from django.test import RequestFactory

    class _User:
        is_authenticated = True
        id = 1

    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    request = RequestFactory().post(
        "/api/task/simulate/",
        data=json.dumps({"id": 1, "simulateEvent": True, "driveHardware": True}),
        content_type="application/json",
    )
    request.user = _User()

    response = simulate.simulate_task(request)

    # 500, like the "Hardware not armed" refusal next to it, and on purpose:
    # fetchApi RESOLVES 202/400/409, so a 400 here could reach the panel as a
    # run that went fine. A 500 rejects and raises the error banner.
    assert response.status_code == 500
    assert b"not allowed on the real robot" in response.content
    assert simulate._SIM_RUN_LOCK.acquire(blocking=False), "refused before taking the run lock"
    simulate._SIM_RUN_LOCK.release()


# ── The verification numbers are recorded when nothing goes wrong ──────────────
# _verify_hw_arrival and _verify_hw_grasp compute the encoder gap and the gripper
# width on every move and used to write them down only when they aborted. A
# passing run left no trace, so the margin behind the 2 degree and 1.5 mm
# thresholds could not be measured on the runs that passed.

@pytest.fixture
def robot_log(monkeypatch, tmp_path):
    from backend.functions import study_log
    path = tmp_path / "misure-robot.jsonl"
    monkeypatch.setattr(study_log, "_LOG_PATH", str(path))
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda *_a, **_k: None)
    monkeypatch.setattr(simulate.time, "sleep", lambda *_a, **_k: None)
    monkeypatch.setattr(simulate, "_abort_task",
                        lambda msg, detail=None: setattr(simulate, "_TASK_ABORT_REASON", msg))
    simulate._TASK_ABORT_REASON = None

    def eventi(kind):
        if not path.exists():
            return []
        rows = [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines()]
        return [r for r in rows if r["kind"] == kind]
    yield eventi
    simulate._TASK_ABORT_REASON = None


def _bridge_reads(monkeypatch, joints):
    bridge = MagicMock()
    bridge.get_actual_joints_real.return_value = joints
    monkeypatch.setattr(simulate, "_bridge", bridge)


def test_a_passing_arrival_leaves_its_gap_in_the_log(robot_log, monkeypatch):
    _bridge_reads(monkeypatch, [10.4, 20.0, 30.0, 40.0, 50.0, 60.0])
    monkeypatch.setattr(simulate.simulation_recursive_blockly_parser, "current_step", "pick_block",
                        raising=False)

    assert simulate._verify_hw_arrival([10.0, 20.0, 30.0, 40.0, 50.0, 60.0]) is True

    (ev,) = robot_log("hw_arrival")
    assert ev["ok"] is True and ev["step"] == "pick_block"
    assert ev["max_delta_deg"] == 0.4 and ev["deltas_deg"][0] == 0.4
    assert ev["tol_deg"] == simulate.HW_VERIFY_TOL_DEG and ev["polls"] == 1
    assert simulate._TASK_ABORT_REASON is None


def test_a_failed_arrival_is_logged_and_still_aborts(robot_log, monkeypatch):
    _bridge_reads(monkeypatch, [15.0, 20.0, 30.0, 40.0, 50.0, 60.0])
    # a clock that runs out after the first poll, so the window closes
    ticks = iter([0.0, 0.0, 99.0, 99.0, 99.0])
    monkeypatch.setattr(simulate.time, "monotonic", lambda: next(ticks, 99.0))

    assert simulate._verify_hw_arrival([10.0, 20.0, 30.0, 40.0, 50.0, 60.0], timeout_s=1) is False

    (ev,) = robot_log("hw_arrival")
    assert ev["ok"] is False and ev["max_delta_deg"] == 5.0
    assert simulate._TASK_ABORT_REASON, "logging must not replace the safety abort"


def test_a_grasp_that_held_records_its_width_and_margin(robot_log, monkeypatch):
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", True)
    # A tube stops the fingers well above the commanded close value.
    monkeypatch.setattr(simulate, "_LAST_HW_HAND_MM", 17.8)

    assert simulate._verify_hw_grasp(14.0) is True
    (ev,) = robot_log("hw_grasp")
    assert ev["hand_mm"] == 17.8 and ev["commanded_mm"] == 14.0
    assert ev["margin_mm"] == 3.8 and ev["empty"] is False


def test_an_empty_grasp_is_logged_as_empty_and_aborts(robot_log, monkeypatch):
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", True)
    monkeypatch.setattr(simulate, "_LAST_HW_HAND_MM", 14.5)

    assert simulate._verify_hw_grasp(14.0) is False

    (ev,) = robot_log("hw_grasp")
    assert ev["empty"] is True
    assert simulate._TASK_ABORT_REASON


def test_a_grasp_with_no_width_is_logged_and_does_not_block(robot_log, monkeypatch):
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", True)
    monkeypatch.setattr(simulate, "_LAST_HW_HAND_MM", None)

    assert simulate._verify_hw_grasp(14.0) is True

    (ev,) = robot_log("hw_grasp")
    assert ev["hand_mm"] is None and ev["empty"] is None


def test_no_grasp_line_in_a_simulation_only_run(robot_log, monkeypatch):
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", False)
    monkeypatch.setattr(simulate, "_LAST_HW_HAND_MM", 14.5)

    assert simulate._verify_hw_grasp(14.0) is True
    assert robot_log("hw_grasp") == []


def test_every_executed_block_leaves_a_step_line(robot_log, monkeypatch):
    """The twin-vs-real comparison needs the order the blocks ran in, and the
    log had only run boundaries and human steps. Each block now writes one
    `step` line with its target, so the same task can be replayed as a sequence
    from a simulation run and from a real-arm run and the two compared."""
    monkeypatch.setattr(simulate, "_bridge", MagicMock())
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", False)

    def notify(t):
        return {"type": "notify_action_block", "fields": {"TASK_DESC": t}}

    code = {**notify("a"), "next": {"block": {**notify("b"), "next": {"block": notify("c")}}}}
    simulate.simulation_recursive_blockly_parser(code, [], [], [], simulate_event=True)

    passi = robot_log("step")
    assert [p["block"] for p in passi] == ["notify_action_block"] * 3
    assert {p["target"] for p in passi} == {"sim"}

    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", True)
    simulate.simulation_recursive_blockly_parser(notify("d"), [], [], [], simulate_event=True)
    assert robot_log("step")[-1]["target"] == "real"


def test_a_stop_request_leaves_its_latency_and_the_halt_result_in_the_log(robot_log, monkeypatch):
    """The chapter on safety has no number for the time from the Stop click to a
    halt the arm confirmed. Two lines bracket it: `stop_requested` on entry and
    `stop_done` with the elapsed time and the arm's own answer."""
    from django.test import RequestFactory

    class _User:
        is_authenticated = True

    bridge = MagicMock()
    bridge.stop.return_value = {"hardware_halt": {"ok": True, "message": ""}}
    monkeypatch.setattr(simulate, "_bridge", bridge)
    monkeypatch.setattr(simulate, "_delete_placed_objects", lambda: None)
    monkeypatch.setattr(simulate, "_set_world_paused", lambda *_a, **_k: None)
    request = RequestFactory().post("/api/task/stop/")
    request.user = _User()

    response = simulate.stop_simulation(request)

    assert response.status_code == 200
    (req,) = robot_log("stop_requested")
    (done,) = robot_log("stop_done")
    assert done["hardware_halt_ok"] is True and done["warning"] is False
    assert 0 <= done["elapsed_s"] < 5


def test_a_stop_whose_halt_failed_is_logged_as_failed(robot_log, monkeypatch):
    from django.test import RequestFactory

    class _User:
        is_authenticated = True

    bridge = MagicMock()
    bridge.stop.return_value = {"hardware_halt": {"ok": False, "message": "no"}}
    monkeypatch.setattr(simulate, "_bridge", bridge)
    monkeypatch.setattr(simulate, "_delete_placed_objects", lambda: None)
    monkeypatch.setattr(simulate, "_set_world_paused", lambda *_a, **_k: None)
    request = RequestFactory().post("/api/task/stop/")
    request.user = _User()

    simulate.stop_simulation(request)

    (done,) = robot_log("stop_done")
    assert done["hardware_halt_ok"] is False and done["warning"] is True


# ── The emergency stop is named, not reported as "rejected" ───────────────────
# 2026-09-29: the red button pressed during a pick ended the run with "The robot
# arm rejected the last move command", which read as a software fault. The
# controller does say what happened — but only on the reconnect, where TakeArm
# fails with 0x83501024 every 2 s until the state is reset.

def _cobotta_utils():
    import importlib
    sys.path.insert(0, os.path.abspath(os.path.join(
        os.path.dirname(__file__), "..", "ros2_ws", "src", "cobotta_rest_api")))
    return importlib.import_module("cobotta_rest_api.cobotta_utils")


def test_the_logged_decimal_error_is_recognised_as_the_emergency_stop():
    utils = _cobotta_utils()
    assert utils.is_estop_error(-2091904988)                      # how the T1 log printed it
    assert utils.is_estop_error(Exception("-2091904988"))
    assert utils.is_estop_error(Exception("controller error 0x83501024"))
    assert utils.is_estop_error(Exception("0x83501024"))


def test_other_bcap_errors_are_not_taken_for_an_emergency_stop():
    utils = _cobotta_utils()
    for other in ("0x81501025", "0x83501029", "0x80070057", "timeout", "", "-2147024809"):
        assert not utils.is_estop_error(Exception(other)), other


def test_an_emergency_stop_answer_from_the_arm_reaches_the_operator_in_words(monkeypatch):
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", True)
    monkeypatch.setattr(simulate, "_abort_task",
                        lambda msg, detail=None: setattr(simulate, "_TASK_ABORT_REASON", msg))
    simulate._TASK_ABORT_REASON = None
    bridge = MagicMock()
    bridge.move_target.return_value = {"ok": False, "message": "emergency_stop"}
    monkeypatch.setattr(simulate, "_bridge", bridge)

    assert simulate._send_hw_target([0.0] * 6, 30.0) is False

    assert "emergency stop" in simulate._TASK_ABORT_REASON
    assert "teach pendant" in simulate._TASK_ABORT_REASON
    simulate._TASK_ABORT_REASON = None


# ── Real-arm gripper tolerance, from the cell (2026-09-29) ────────────────────
# Measured with the width finally readable: tube in the fingers -> 14.143, 14.150,
# 14.195 mm; empty gripper -> 14.002 mm; command 14 mm in every case.
_HELD_MM = (14.143, 14.150, 14.195)
_EMPTY_MM = (14.002,)
_COMMANDED_MM = 14.0


def _real_tol(monkeypatch):
    import importlib

    from backend.functions import calibration

    monkeypatch.setenv("DRIVE_HARDWARE", "1")
    real = importlib.reload(calibration)
    tol = real.HW_GRASP_SLIP_TOL_MM
    monkeypatch.delenv("DRIVE_HARDWARE", raising=False)
    importlib.reload(calibration)
    return tol


def test_the_real_tolerance_separates_the_measured_held_and_empty_grasps(monkeypatch):
    tol = _real_tol(monkeypatch)
    for w in _HELD_MM:
        assert w - _COMMANDED_MM > tol, f"a held grasp at {w} mm would abort at tol {tol}"
    for w in _EMPTY_MM:
        assert w - _COMMANDED_MM <= tol, f"an empty grasp at {w} mm would pass at tol {tol}"


def test_the_sim_tolerance_is_unchanged():
    from backend.functions import calibration
    assert calibration._SIM_PROFILE["HW_GRASP_SLIP_TOL_MM"] == 1.5


def test_a_grasp_row_written_after_a_stop_is_marked_as_such(robot_log, monkeypatch):
    """After an operator Stop the pick handler still reaches the grasp check, with
    the width left over from the previous move (gripper open, 30 mm). That row is
    not a grasp, and it used to pass as a good one with a 16 mm margin."""
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", True)
    monkeypatch.setattr(simulate, "_LAST_HW_HAND_MM", 30.0)
    simulate.SIMULATION_STOP_EVENT.set()
    try:
        simulate._verify_hw_grasp(14.0)
    finally:
        simulate.SIMULATION_STOP_EVENT.clear()
    (ev,) = robot_log("hw_grasp")
    assert ev["stopping"] is True
