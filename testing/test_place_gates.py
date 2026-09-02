"""Place/pick hard-gate regression tests (offline, no Gazebo/ROS/DB).

Run:
    DJANGO_SETTINGS_MODULE=django_project_conf.settings poetry run python -m pytest testing/test_place_gates.py -v

Covers the fake-place fix: when IK fails during a place, the object must
NOT be detached from the gripper and snapped to the target slot — that was
a silent "place succeeded" lie found on the physical arm. Real
object/location SDFs ("tube", "collector") are used as-is (same pattern as
test_grasp_planner.py) — only network/ROS calls and the specific IK step
under test are mocked.
"""
import sys
import os
import json
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


# ── place: preconditions that used to `return` without aborting (W2.3) ──────
# These used to just print+return, so the run reported success_response()
# with the object silently never placed — the same "fake place" class of bug
# the IK/FK gates below were built to close, just earlier in the function.

def test_place_sync_failure_aborts(monkeypatch):
    monkeypatch.setattr(simulate, "sync_current_state_from_ros", lambda: False)

    simulate.simulate_ros_place(picked_obj_name="tube", objectsOfUser=None, location_name="collector")

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "Lost track of the robot arm" in simulate._TASK_ABORT_REASON
    simulate.detach_object_from_gripper.assert_not_called()


def test_place_unresolved_dimensions_aborts(monkeypatch):
    monkeypatch.setattr(simulate, "resolve_object_metrics", lambda *a, **kw: (None, None))

    simulate.simulate_ros_place(picked_obj_name="unknown_thing", objectsOfUser=None, location_name="collector")

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "dimensions aren't known" in simulate._TASK_ABORT_REASON
    simulate.detach_object_from_gripper.assert_not_called()


def test_place_detach_failure_aborts_before_snap(monkeypatch):
    """W2.5: the snap-to-slot teleport assumes the weld already let go — a
    failed detach must abort instead of teleporting a still-welded object."""
    monkeypatch.setattr(simulate, "solve_gazebo_ik", lambda *a, **kw: [0.0] * 6)
    monkeypatch.setattr(simulate, "build_vertical_ik_path", lambda *a, **kw: [[0.0] * 6])
    monkeypatch.setattr(simulate, "fk_position_error", lambda *a, **kw: (0.0, 0.0))
    monkeypatch.setattr(simulate, "get_sdf_dimensions", lambda *a, **kw: (0.02, 0.02, 0.0))
    monkeypatch.setattr(simulate, "detach_object_from_gripper", MagicMock(return_value=False))

    simulate.simulate_ros_place(picked_obj_name="tube", objectsOfUser=None, location_name="collector")

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "release" in simulate._TASK_ABORT_REASON
    simulate.set_object_world_pose.assert_not_called()
    simulate._persist_placed_object.assert_not_called()


# ── place: no pick context (simpler precondition — has_pick_context=False) ──

def test_place_approach_ik_fail_aborts_no_snap(monkeypatch):
    monkeypatch.setattr(simulate, "solve_gazebo_ik", lambda *a, **kw: None)

    simulate.simulate_ros_place(picked_obj_name="tube", objectsOfUser=None, location_name="collector")

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "no safe path found" in simulate._TASK_ABORT_REASON
    simulate.detach_object_from_gripper.assert_not_called()
    simulate.set_object_world_pose.assert_not_called()
    simulate._persist_placed_object.assert_not_called()


def test_place_descent_ik_fail_aborts_no_snap(monkeypatch):
    # Approach succeeds (any joint vector), descent path fails.
    monkeypatch.setattr(simulate, "solve_gazebo_ik", lambda *a, **kw: [0.0] * 6)
    monkeypatch.setattr(simulate, "build_vertical_ik_path", lambda *a, **kw: None)

    simulate.simulate_ros_place(picked_obj_name="tube", objectsOfUser=None, location_name="collector")

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "no safe path found" in simulate._TASK_ABORT_REASON
    simulate.detach_object_from_gripper.assert_not_called()
    simulate.set_object_world_pose.assert_not_called()
    simulate._persist_placed_object.assert_not_called()


def test_place_fk_guard_fail_aborts_no_snap(monkeypatch):
    monkeypatch.setattr(simulate, "solve_gazebo_ik", lambda *a, **kw: [0.0] * 6)
    monkeypatch.setattr(simulate, "build_vertical_ik_path", lambda *a, **kw: [[0.0] * 6])
    # Force the post-descent FK residual over tolerance.
    monkeypatch.setattr(simulate, "fk_position_error", lambda *a, **kw: (simulate.IK_POS_TOL * 10, 0.0))

    simulate.simulate_ros_place(picked_obj_name="tube", objectsOfUser=None, location_name="collector")

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "didn't reach the spot precisely enough" in simulate._TASK_ABORT_REASON
    simulate.detach_object_from_gripper.assert_not_called()
    simulate.set_object_world_pose.assert_not_called()
    simulate._persist_placed_object.assert_not_called()


def test_place_snap_to_slot_fail_aborts_no_persist(monkeypatch):
    """Regression: snap-to-slot used to be best-effort (log and continue) —
    a failed teleport after the weld is already released left the object's
    real position unknown, while _persist_placed_object still spawned a
    fresh entity at the intended slot as if the teleport had succeeded —
    the same "fake place" class of bug this file's pick/place IK gates were
    built to close."""
    monkeypatch.setattr(simulate, "solve_gazebo_ik", lambda *a, **kw: [0.0] * 6)
    monkeypatch.setattr(simulate, "build_vertical_ik_path", lambda *a, **kw: [[0.0] * 6])
    monkeypatch.setattr(simulate, "fk_position_error", lambda *a, **kw: (0.0, 0.0))
    monkeypatch.setattr(simulate, "get_sdf_dimensions", lambda *a, **kw: (0.02, 0.02, 0.0))
    monkeypatch.setattr(simulate, "set_object_world_pose", MagicMock(return_value=False))

    simulate.simulate_ros_place(picked_obj_name="tube", objectsOfUser=None, location_name="collector")

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "check the workcell" in simulate._TASK_ABORT_REASON
    simulate.detach_object_from_gripper.assert_called_once()  # already released, can't undo
    simulate._persist_placed_object.assert_not_called()


def test_place_success_path_does_snap(monkeypatch):
    """Sanity check the gates aren't blocking a genuinely successful place."""
    monkeypatch.setattr(simulate, "solve_gazebo_ik", lambda *a, **kw: [0.0] * 6)
    monkeypatch.setattr(simulate, "build_vertical_ik_path", lambda *a, **kw: [[0.0] * 6])
    monkeypatch.setattr(simulate, "fk_position_error", lambda *a, **kw: (0.0, 0.0))
    monkeypatch.setattr(simulate, "get_sdf_dimensions", lambda *a, **kw: (0.02, 0.02, 0.0))

    simulate.simulate_ros_place(picked_obj_name="tube", objectsOfUser=None, location_name="collector")

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

    simulate.simulate_ros_place(picked_obj_name="tube", objectsOfUser=None, location_name="collector")

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "no safe path found" in simulate._TASK_ABORT_REASON
    simulate.detach_object_from_gripper.assert_not_called()
    simulate.set_object_world_pose.assert_not_called()
    simulate._persist_placed_object.assert_not_called()


# ── pick: FK guard (mirrors the place FK-guard test) ─────────────────────────

def test_pick_fk_guard_fail_aborts_no_weld(monkeypatch):
    monkeypatch.setattr(simulate, "solve_gazebo_ik", lambda *a, **kw: [0.0] * 6)
    monkeypatch.setattr(simulate, "build_vertical_ik_path", lambda *a, **kw: [[0.0] * 6])
    monkeypatch.setattr(simulate, "fk_position_error", lambda *a, **kw: (simulate.IK_POS_TOL * 10, 0.0))
    monkeypatch.setattr(simulate, "debug_fk", lambda *a, **kw: None)

    simulate.simulate_ros_pick(obj=None, sdf_name="tube")

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "didn't reach the object precisely enough" in simulate._TASK_ABORT_REASON
    simulate.set_object_world_pose.assert_not_called()
    simulate.attach_object_to_gripper.assert_not_called()


def test_pick_approach_ik_fail_aborts(monkeypatch):
    monkeypatch.setattr(simulate, "solve_gazebo_ik", lambda *a, **kw: None)

    simulate.simulate_ros_pick(obj=None, sdf_name="tube")

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "no safe path found" in simulate._TASK_ABORT_REASON
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

    simulate.simulate_ros_pick(obj=None, sdf_name="tube")

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "didn't attach to the gripper" in simulate._TASK_ABORT_REASON
    # smooth_move fires once for the pre-attach approach; the finger-close
    # call that would follow a verified weld must never happen.
    assert simulate.smooth_move.call_count == 1


# ── _h_pick: malformed OBJECT data must not crash ───────────────────────────

def test_pick_with_object_data_missing_id_does_not_crash(monkeypatch):
    """Regression: `_h_pick` used to index `object_data["id"]` unguarded —
    a valid OBJECT payload missing the `id` key (same reachable shape as the
    already-fixed WHEN/repeat/wait cases: a hand-built block or an LLM
    proposal that only fills in `name`) raised KeyError, swallowed by the
    parser's blanket except, truncating the chain. Now `.get("id")` returns
    None, the objectsOfUser lookup misses, and _h_pick falls back to the
    payload's `name` — same class of fix as _h_place/_h_processing."""
    monkeypatch.setattr(simulate, "get_sdf_dimensions", lambda *a, **kw: (0.02, 0.02, 0.0))
    monkeypatch.setattr(simulate, "solve_gazebo_ik", lambda *a, **kw: None)  # fail fast
    monkeypatch.setattr(simulate, "debug_fk", lambda *a, **kw: None)
    simulate._spawned_in_world.clear()

    mock_objects = MagicMock()
    mock_objects.filter.return_value.first.return_value = None  # no DB match — falls back to name

    code = {
        "type": "pick_block",
        "inputs": {
            "OBJECT": {"block": {"data": json.dumps({"name": "tube"})}},  # no "id"
        },
    }
    simulate.simulation_recursive_blockly_parser(code, mock_objects, [], [], simulate_event=True)

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert "no safe path found" in simulate._TASK_ABORT_REASON
    simulate._spawned_in_world.clear()


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


def test_persist_placed_object_removes_then_creates(monkeypatch):
    """Removal first, spawn second, and the removal is the WAITING one.

    The seam moved: the bare `gz service .../remove` this used to inspect now
    lives inside remove_entity_and_wait, which also polls the world until the
    entity is really gone. Patching it here keeps the test about ordering and
    naming — spawning placed_N on top of a live "object" interpenetrates two
    colliders — instead of about how the wait is implemented.
    """
    removed, created = [], []
    monkeypatch.setattr(simulate, "remove_entity_and_wait",
                        lambda name, **kw: removed.append(name) or True)
    monkeypatch.setattr(simulate, "launch_wsl_ros_command",
                        lambda cmd, **kw: created.append(cmd) or True)

    ok = _real_persist_placed_object("tube", 1.0, 2.0, 3.0, yaw=0.0)

    assert ok is True
    assert removed == ["object"]
    assert len(created) == 1
    assert "create" in created[0] and 'name: "placed_1"' in created[0]
    assert simulate._placed_in_world == ["placed_1"]


def test_persist_placed_object_gives_up_when_the_entity_will_not_go_away(monkeypatch):
    """No spawn on top of a corpse.

    An "object" still in the world after the wait means the physics engine is
    about to rename the newcomer and hold a dangling reference — the
    Physics.cc:2967 storm. Skipping persistence loses a placed tube; spawning
    anyway corrupts the rest of the session.
    """
    monkeypatch.setattr(simulate, "remove_entity_and_wait", lambda name, **kw: False)
    spawns = []
    monkeypatch.setattr(
        simulate, "launch_wsl_ros_command", lambda cmd, **kw: spawns.append(cmd) or True
    )

    assert _real_persist_placed_object("tube", 1.0, 2.0, 3.0) is False
    assert spawns == []
    assert simulate._placed_in_world == []


def test_persist_placed_object_increments_across_calls(monkeypatch):
    monkeypatch.setattr(simulate, "remove_entity_and_wait", lambda name, **kw: True)
    monkeypatch.setattr(simulate, "launch_wsl_ros_command", lambda *a, **kw: True)

    _real_persist_placed_object("tube", 0, 0, 0)
    _real_persist_placed_object("tube", 0, 0, 0)

    assert simulate._placed_in_world == ["placed_1", "placed_2"]


def test_persist_placed_object_skips_spawn_on_delete_failure(monkeypatch):
    calls = []

    def record(cmd, **kw):
        calls.append(cmd)
        return "remove" not in cmd  # delete fails, would-be create succeeds
    monkeypatch.setattr(simulate, "launch_wsl_ros_command", record)

    ok = _real_persist_placed_object("tube", 0, 0, 0)

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


# ── per-location release height ──────────────────────────────────────────────

def test_cup_release_is_raised_and_the_rack_is_not():
    """The 2 cm the cup asked for must not reach the tube rack.

    The clearance terms inside resolve_place_z are shared by every location, so
    the tempting fix — bump the +0.003 container clearance — would also release
    tubes into the rack from 2 cm up. A rack slot has 1.3 mm of side clearance
    and wants the release as low as it will go: the opposite requirement, which
    is why the offset is keyed by location.
    """
    from backend.functions.calibration import PLACE_Z_OFFSETS

    tube_height = 0.10
    cup = simulate.resolve_place_z("cup", tube_height)
    rack = simulate.resolve_place_z("tube rack", tube_height)

    assert PLACE_Z_OFFSETS["cup"] == pytest.approx(0.020)
    assert cup == pytest.approx(
        simulate.PICK_Z_REF_OFFSET + 0.002 + 0.003 + 0.07 + 0.020, abs=1e-4
    )
    assert "tube_rack" not in PLACE_Z_OFFSETS
    assert rack == pytest.approx(
        simulate.PICK_Z_REF_OFFSET + 0.0005 + 0.003 + 0.07, abs=1e-4
    )
