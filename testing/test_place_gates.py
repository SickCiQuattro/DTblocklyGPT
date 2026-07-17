"""Place/pick hard-gate regression tests (offline, no Gazebo/ROS/DB).

Run:
    DJANGO_SETTINGS_MODULE=django_project_conf.settings poetry run python -m pytest testing/test_place_gates.py -v

Covers the fake-place fix: when IK fails during a place, the object must
NOT be detached from the gripper and snapped to the target slot — that was
the silent "place succeeded" lie the physical session found (docs/cobotta-
physical-session-2026-07-07.md §7). Real object/location SDFs ("flask",
"collector") are used as-is (same pattern as test_grasp_planner.py) — only
network/ROS calls and the specific IK step under test are mocked.
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

# Captured before the autouse fixture below ever monkeypatches the module
# attribute, so unit tests that want the REAL implementation (attach retry
# parsing, persist-placed spawn/delete ordering) can call these directly
# while every other test in this file still gets the simple mocked version.
_real_attach_object_to_gripper = simulate.attach_object_to_gripper
_real_persist_placed_object = simulate._persist_placed_object


@pytest.fixture(autouse=True)
def _reset_state():
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None
    for attr in ("last_pick_x", "last_pick_y", "last_pick_z_carry", "last_pick_grasp_yaw",
                 "last_pick_hand_close", "last_pick_carry_joints"):
        if hasattr(simulate.simulation_recursive_blockly_parser, attr):
            delattr(simulate.simulation_recursive_blockly_parser, attr)
    yield
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None
    for attr in ("last_pick_x", "last_pick_y", "last_pick_z_carry", "last_pick_grasp_yaw",
                 "last_pick_hand_close", "last_pick_carry_joints"):
        if hasattr(simulate.simulation_recursive_blockly_parser, attr):
            delattr(simulate.simulation_recursive_blockly_parser, attr)


@pytest.fixture(autouse=True)
def _mock_ros(monkeypatch):
    """Every place/pick call syncs state and detaches/snaps/attaches over the
    Flask bridge — none of that is reachable offline, mock it out so only the
    IK-gating logic under test actually runs."""
    monkeypatch.setattr(simulate, "sync_current_state_from_ros", lambda: True)
    monkeypatch.setattr(simulate, "smooth_move", MagicMock())
    monkeypatch.setattr(simulate, "send_waypoints", MagicMock())
    monkeypatch.setattr(simulate, "detach_object_from_gripper", MagicMock(return_value=True))
    monkeypatch.setattr(simulate, "attach_object_to_gripper", MagicMock(return_value=True))
    monkeypatch.setattr(simulate, "set_object_world_pose", MagicMock(return_value=True))
    monkeypatch.setattr(simulate, "_verify_hw_grasp", lambda commanded: True)
    monkeypatch.setattr(simulate, "_persist_placed_object", MagicMock(return_value=True))
    monkeypatch.setattr(simulate, "launch_wsl_ros_command", MagicMock(return_value=True))


# ── place: no pick context (simpler precondition — has_pick_context=False) ──

def test_place_approach_ik_fail_aborts_no_snap(monkeypatch):
    monkeypatch.setattr(simulate, "solve_gazebo_ik", lambda *a, **kw: None)

    simulate.simulate_ros_place(picked_obj_name="flask", objectsOfUser=None, location_name="collector")

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "approach IK failed" in simulate._TASK_ABORT_REASON
    simulate.detach_object_from_gripper.assert_not_called()
    simulate.set_object_world_pose.assert_not_called()
    simulate._persist_placed_object.assert_not_called()


def test_place_descent_ik_fail_aborts_no_snap(monkeypatch):
    # Approach succeeds (any joint vector), descent path fails.
    monkeypatch.setattr(simulate, "solve_gazebo_ik", lambda *a, **kw: [0.0] * 6)
    monkeypatch.setattr(simulate, "build_vertical_ik_path", lambda *a, **kw: None)

    simulate.simulate_ros_place(picked_obj_name="flask", objectsOfUser=None, location_name="collector")

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "descent IK failed" in simulate._TASK_ABORT_REASON
    simulate.detach_object_from_gripper.assert_not_called()
    simulate.set_object_world_pose.assert_not_called()
    simulate._persist_placed_object.assert_not_called()


def test_place_fk_guard_fail_aborts_no_snap(monkeypatch):
    monkeypatch.setattr(simulate, "solve_gazebo_ik", lambda *a, **kw: [0.0] * 6)
    monkeypatch.setattr(simulate, "build_vertical_ik_path", lambda *a, **kw: [[0.0] * 6])
    # Force the post-descent FK residual over tolerance.
    monkeypatch.setattr(simulate, "fk_position_error", lambda *a, **kw: (simulate.IK_POS_TOL * 10, 0.0))

    simulate.simulate_ros_place(picked_obj_name="flask", objectsOfUser=None, location_name="collector")

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "FK guard" in simulate._TASK_ABORT_REASON
    simulate.detach_object_from_gripper.assert_not_called()
    simulate.set_object_world_pose.assert_not_called()
    simulate._persist_placed_object.assert_not_called()


def test_place_success_path_does_snap(monkeypatch):
    """Sanity check the gates aren't blocking a genuinely successful place."""
    monkeypatch.setattr(simulate, "solve_gazebo_ik", lambda *a, **kw: [0.0] * 6)
    monkeypatch.setattr(simulate, "build_vertical_ik_path", lambda *a, **kw: [[0.0] * 6])
    monkeypatch.setattr(simulate, "fk_position_error", lambda *a, **kw: (0.0, 0.0))
    monkeypatch.setattr(simulate, "get_sdf_dimensions", lambda *a, **kw: (0.02, 0.02, 0.0))

    simulate.simulate_ros_place(picked_obj_name="flask", objectsOfUser=None, location_name="collector")

    assert not simulate.SIMULATION_STOP_EVENT.is_set()
    assert simulate._TASK_ABORT_REASON is None
    simulate.detach_object_from_gripper.assert_called_once()
    simulate.set_object_world_pose.assert_called_once()
    simulate._persist_placed_object.assert_called_once()


# ── place: with pick context (has_pick_context=True — gantry transit path) ──

def _set_pick_context():
    p = simulate.simulation_recursive_blockly_parser
    p.last_pick_x = -0.05
    p.last_pick_y = -0.28
    p.last_pick_z_carry = 0.5  # deliberately high: forces the clamp to CARRY_Z_MAX
    #                            and skips the pre-lift branch (z_carry ends up
    #                            below pick_z_carry+0.005, see CARRY_Z_MAX clamp).
    p.last_pick_grasp_yaw = 0.0
    p.last_pick_hand_close = 10
    p.last_pick_carry_joints = [0.0] * 6


def test_place_transit_ik_fail_aborts_no_snap(monkeypatch):
    _set_pick_context()
    monkeypatch.setattr(simulate, "build_cartesian_ik_path", lambda *a, **kw: None)

    simulate.simulate_ros_place(picked_obj_name="flask", objectsOfUser=None, location_name="collector")

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "transit IK failed" in simulate._TASK_ABORT_REASON
    simulate.detach_object_from_gripper.assert_not_called()
    simulate.set_object_world_pose.assert_not_called()
    simulate._persist_placed_object.assert_not_called()


# ── pick: FK guard (mirrors the place FK-guard test) ─────────────────────────

def test_pick_fk_guard_fail_aborts_no_weld(monkeypatch):
    monkeypatch.setattr(simulate, "solve_gazebo_ik", lambda *a, **kw: [0.0] * 6)
    monkeypatch.setattr(simulate, "build_vertical_ik_path", lambda *a, **kw: [[0.0] * 6])
    monkeypatch.setattr(simulate, "fk_position_error", lambda *a, **kw: (simulate.IK_POS_TOL * 10, 0.0))
    monkeypatch.setattr(simulate, "debug_fk", lambda *a, **kw: None)

    simulate.simulate_ros_pick(obj=None, sdf_name="flask")

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "FK guard" in simulate._TASK_ABORT_REASON
    simulate.set_object_world_pose.assert_not_called()
    simulate.attach_object_to_gripper.assert_not_called()


def test_pick_approach_ik_fail_aborts(monkeypatch):
    monkeypatch.setattr(simulate, "solve_gazebo_ik", lambda *a, **kw: None)

    simulate.simulate_ros_pick(obj=None, sdf_name="flask")

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "approach IK failed" in simulate._TASK_ABORT_REASON
    simulate.set_object_world_pose.assert_not_called()


def test_pick_weld_unverified_aborts(monkeypatch):
    """Mirrors the FK-guard test: an unverified weld must abort before the
    fingers close, not just log a warning and carry on as if it grabbed."""
    monkeypatch.setattr(simulate, "solve_gazebo_ik", lambda *a, **kw: [0.0] * 6)
    monkeypatch.setattr(simulate, "build_vertical_ik_path", lambda *a, **kw: [[0.0] * 6])
    monkeypatch.setattr(simulate, "fk_position_error", lambda *a, **kw: (0.0, 0.0))
    monkeypatch.setattr(simulate, "debug_fk", lambda *a, **kw: None)
    monkeypatch.setattr(simulate, "get_sdf_dimensions", lambda *a, **kw: (0.02, 0.02, 0.0))
    monkeypatch.setattr(simulate, "attach_object_to_gripper", MagicMock(return_value=False))

    simulate.simulate_ros_pick(obj=None, sdf_name="flask")

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "weld failed" in simulate._TASK_ABORT_REASON
    # smooth_move fires once for the pre-attach approach; the finger-close
    # call that would follow a verified weld must never happen.
    assert simulate.smooth_move.call_count == 1


# ── attach_object_to_gripper: state-topic parsing (real implementation) ──────
# Bypasses the autouse mock via the real-function reference captured above the
# fixture — these test the parser itself, not the pick/place gates around it.

def test_attach_verified_on_first_attempt(monkeypatch):
    monkeypatch.setattr(simulate, "_shell_output", lambda cmd: 'data: "attached"\n')

    assert _real_attach_object_to_gripper() is True


def test_attach_unverified_after_max_attempts(monkeypatch):
    calls = MagicMock(return_value='data: "detached"\n')
    monkeypatch.setattr(simulate, "_shell_output", calls)

    assert _real_attach_object_to_gripper() is False
    assert calls.call_count == simulate._ATTACH_MAX_ATTEMPTS


def test_attach_verified_on_retry(monkeypatch):
    outputs = iter(["", 'data: "attached"\n'])
    monkeypatch.setattr(simulate, "_shell_output", lambda cmd: next(outputs))

    assert _real_attach_object_to_gripper() is True


# ── _persist_placed_object / _delete_placed_objects (real implementation) ───

@pytest.fixture(autouse=True)
def _reset_placed_registry():
    simulate._placed_in_world = []
    simulate._placed_seq = 0
    yield
    simulate._placed_in_world = []
    simulate._placed_seq = 0


def test_persist_placed_object_deletes_then_creates(monkeypatch):
    calls = []

    def record(cmd, **kw):
        calls.append(cmd)
        return True

    monkeypatch.setattr(simulate, "launch_wsl_ros_command", record)

    ok = _real_persist_placed_object("flask", 1.0, 2.0, 3.0, yaw=0.0)

    assert ok is True
    assert len(calls) == 2
    # First call removes the reusable "object" entity, second spawns placed_1.
    assert "remove" in calls[0] and 'name: "object"' in calls[0]
    assert "create" in calls[1] and 'name: "placed_1"' in calls[1]
    assert simulate._placed_in_world == ["placed_1"]


def test_persist_placed_object_increments_across_calls(monkeypatch):
    monkeypatch.setattr(simulate, "launch_wsl_ros_command", lambda *a, **kw: True)

    _real_persist_placed_object("flask", 0, 0, 0)
    _real_persist_placed_object("flask", 0, 0, 0)

    assert simulate._placed_in_world == ["placed_1", "placed_2"]


def test_persist_placed_object_skips_spawn_on_delete_failure(monkeypatch):
    calls = []

    def record(cmd, **kw):
        calls.append(cmd)
        return "remove" not in cmd  # delete fails, would-be create succeeds
    monkeypatch.setattr(simulate, "launch_wsl_ros_command", record)

    ok = _real_persist_placed_object("flask", 0, 0, 0)

    assert ok is False
    assert len(calls) == 1  # never reached the create call
    assert simulate._placed_in_world == []


def test_delete_placed_objects_sweeps_registry(monkeypatch):
    simulate._placed_in_world = ["placed_1", "placed_2"]
    calls = []
    monkeypatch.setattr(simulate, "launch_wsl_ros_command",
                         lambda cmd, **kw: calls.append(cmd) or True)

    simulate._delete_placed_objects()

    assert len(calls) == 2
    assert all('name: "placed_' in c for c in calls)
    assert simulate._placed_in_world == []
