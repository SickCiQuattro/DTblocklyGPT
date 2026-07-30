"""Sim-vs-hardware gripper/pose parity regression tests (offline, no Gazebo/ROS).

Run:
    poetry run python -m pytest testing/test_twin_parity.py -v

Covers two twin-fidelity bugs found while auditing the digital twin:
- _h_move_to used to send the sim gripper a hardcoded CLOSE value while
  sending hardware OPEN (or vice versa on the DB-pose branch) — an object
  held mid-carry would be dropped on the real arm while the twin still
  showed it gripped (W1.1).
- _h_gripper/_h_open_gripper/_h_close_gripper used to fly the *simulated*
  arm to a hardcoded home pose (0,0,90,0,0,0) via a dead joint_abs flag,
  while the real arm stayed exactly where it was — a full-pose divergence
  on every gripper-only block (W1.2).

Both are pinned here as "the sim and hardware calls must agree on gripper
aperture, and the sim call must not move the arm on a gripper-only block" —
regardless of the exact fix, a future change that reintroduces the
divergence should fail these.
"""
import sys
import os
import json
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

from backend.functions import simulate

_DEFAULT_JOINTS = [0.0, 0.0, 90.0, 0.0, 0.0, 0.0]
_DEFAULT_HAND = 30.0


@pytest.fixture(autouse=True)
def _reset_state():
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None
    simulate.set_current_state(list(_DEFAULT_JOINTS), _DEFAULT_HAND)
    yield
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None
    simulate.set_current_state(list(_DEFAULT_JOINTS), _DEFAULT_HAND)


@pytest.fixture(autouse=True)
def _no_real_sleep(monkeypatch):
    """These handlers call _interruptible_sleep(1-2) on the success path —
    irrelevant to what's under test (the call arguments), so skip the wait."""
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda *_a, **_kw: None)


def _run_block(block_type, fields=None, inputs=None):
    """Invoke one block through the real dispatcher, no "id" field so the
    (best-effort, but still a real network call if reached) block-step
    highlight notify is skipped entirely (HIGHLIGHTABLE_BLOCKS gate)."""
    code = {"type": block_type, "fields": fields or {}}
    if inputs:
        code["inputs"] = inputs
    simulate.simulation_recursive_blockly_parser(code, [], [], MagicMock(), simulate_event=True)


# ── _h_move_to: sim/hardware must see the same gripper aperture (W1.1) ──────

def test_move_to_default_pose_keeps_gripper_parity(monkeypatch):
    """No DB pose for the location → SAFE_INTERMEDIATE_POSE fallback branch."""
    simulate.set_current_state([1.0] * 6, 12.5)  # arbitrary "holding something" aperture
    mock_move = MagicMock()
    mock_hw = MagicMock(return_value=True)
    monkeypatch.setattr(simulate, "simulate_ros_move", mock_move)
    monkeypatch.setattr(simulate, "_send_hw_target", mock_hw)

    locations = MagicMock()
    locations.filter.return_value.first.return_value = None

    code = {
        "type": "move_to_block",
        "fields": {"MOTION_TYPE": "LINEAR"},
        "inputs": {"LOCATION": {"block": {"data": json.dumps({"id": 1, "name": "somewhere"})}}},
    }
    simulate.simulation_recursive_blockly_parser(code, [], [], locations, simulate_event=True)

    sim_hand = mock_move.call_args.args[-1]
    hw_hand = mock_hw.call_args.args[1]
    assert sim_hand == hw_hand == 12.5


def test_move_to_db_pose_keeps_gripper_parity(monkeypatch):
    """DB has a stored joint pose for the location — the other branch."""
    simulate.set_current_state([1.0] * 6, 7.0)
    mock_move = MagicMock()
    mock_hw = MagicMock(return_value=True)
    monkeypatch.setattr(simulate, "simulate_ros_move", mock_move)
    monkeypatch.setattr(simulate, "_send_hw_target", mock_hw)

    loc = MagicMock()
    loc.position = {"j1": 0, "j2": 0, "j3": 90, "j4": 0, "j5": 0, "j6": 0}
    locations = MagicMock()
    locations.filter.return_value.first.return_value = loc

    code = {
        "type": "move_to_block",
        "fields": {"MOTION_TYPE": "LINEAR"},
        "inputs": {"LOCATION": {"block": {"data": json.dumps({"id": 1, "name": "somewhere"})}}},
    }
    simulate.simulation_recursive_blockly_parser(code, [], [], locations, simulate_event=True)

    sim_hand = mock_move.call_args.args[-1]
    hw_hand = mock_hw.call_args.args[1]
    assert sim_hand == hw_hand == 7.0


# ── gripper-only blocks: sim arm must hold position, not fly home (W1.2) ────

@pytest.mark.parametrize("block_type,field_state", [
    ("gripper_block", "OPEN"),
    ("gripper_block", "CLOSE"),
    ("open_gripper_block", None),
    ("close_gripper_block", None),
])
def test_gripper_blocks_hold_arm_pose(monkeypatch, block_type, field_state):
    current_joints = [10.0, -20.0, 45.0, 5.0, -5.0, 15.0]
    simulate.set_current_state(current_joints, 30.0)
    mock_move = MagicMock()
    mock_hw = MagicMock(return_value=True)
    monkeypatch.setattr(simulate, "simulate_ros_move", mock_move)
    monkeypatch.setattr(simulate, "_send_hw_target", mock_hw)

    fields = {"GRIPPER_STATE": field_state} if field_state else {}
    _run_block(block_type, fields=fields)

    # The sim call must move to wherever the arm currently is, never a
    # hardcoded home pose — that was the actual bug (W1.2).
    sim_joints = list(mock_move.call_args.args[:6])
    assert sim_joints == current_joints

    # Hardware call is always hand-only for these blocks.
    mock_hw.assert_called_once()
    hw_args, hw_kwargs = mock_hw.call_args
    assert hw_args[0] == []
    assert hw_kwargs.get("hand_only") is True

    # Sim and hardware must agree on the commanded aperture.
    sim_hand = mock_move.call_args.args[-1]
    hw_hand = hw_args[1]
    assert sim_hand == hw_hand

    # The module's own state must reflect the commanded aperture afterwards
    # (previously never updated here — see simulate.py _h_gripper/_h_open_gripper).
    _, current_hand_after = simulate.get_current_state()
    assert current_hand_after == sim_hand


def test_gripper_close_uses_close_value(monkeypatch):
    simulate.set_current_state([0.0] * 6, 30.0)
    mock_move = MagicMock()
    monkeypatch.setattr(simulate, "simulate_ros_move", mock_move)
    monkeypatch.setattr(simulate, "_send_hw_target", MagicMock(return_value=True))

    _run_block("gripper_block", fields={"GRIPPER_STATE": "CLOSE"})

    assert mock_move.call_args.args[-1] == simulate.ROS_CLOSE_GRIPPER_WITH_OBJECT


def test_gripper_open_uses_open_value(monkeypatch):
    simulate.set_current_state([0.0] * 6, 10.0)
    mock_move = MagicMock()
    monkeypatch.setattr(simulate, "simulate_ros_move", mock_move)
    monkeypatch.setattr(simulate, "_send_hw_target", MagicMock(return_value=True))

    _run_block("gripper_block", fields={"GRIPPER_STATE": "OPEN"})

    assert mock_move.call_args.args[-1] == simulate.ROS_OPEN_GRIPPER


# ── simulate_ros_move: joint_abs was a dead parameter (W1.3) ────────────────

def test_simulate_ros_move_has_no_joint_abs_param():
    import inspect
    sig = inspect.signature(simulate.simulate_ros_move)
    assert "joint_abs" not in sig.parameters


# ── _send_hw_path: waypoint thinning for smoother real-hardware motion ─────
# Confirmed on physical hardware 2026-07-29: every waypoint of a pick/place
# ramp forwarded to the real arm is a separate b-CAP PTP that decelerates to
# a full stop, so a dense ramp played point-by-point reads as visibly
# stepped/jerky motion. `max_points` is a hard CAP on the total hardware
# calls for the segment (not a stride — a stride gave a different stop count
# per ramp length, 2-6 depending on the segment, which is what this replaced
# after the same hardware session showed an inconsistent number of stops).
# Endpoints included, final point always kept (the FK/precision-critical
# point of the segment) — this is a physical motion-quality tuning knob
# (HW_MAX_WAYPOINTS_PER_SEGMENT), not a correctness fix, so it's pinned here
# as "does what the constant documentation claims" rather than as a
# regression test.

def test_send_hw_path_caps_dense_ramp_to_max_points(monkeypatch):
    joints_list = [[float(i)] * 6 for i in range(10)]  # 10 waypoints, 0..9
    mock_hw = MagicMock(return_value=True)
    monkeypatch.setattr(simulate, "_send_hw_target", mock_hw)

    result = simulate._send_hw_path(joints_list, 30.0, max_points=2)

    assert result is True
    sent_first_joint = [call.args[0][0] for call in mock_hw.call_args_list]
    assert sent_first_joint == [0.0, 9.0]  # evenly spaced across [0, n-1], last always kept


def test_send_hw_path_caps_short_ramp_to_its_own_length(monkeypatch):
    """A ramp no longer than the cap sends every point — nothing to thin."""
    joints_list = [[0.0] * 6, [1.0] * 6]  # 2 waypoints
    mock_hw = MagicMock(return_value=True)
    monkeypatch.setattr(simulate, "_send_hw_target", mock_hw)

    result = simulate._send_hw_path(joints_list, 30.0, max_points=2)

    assert result is True
    assert mock_hw.call_count == 2


def test_send_hw_path_max_points_none_sends_every_point(monkeypatch):
    """Default used by simulate_ros_action's Skill playback — every recorded
    point matters there (e.g. an oscillating "shake"), so thinning must
    stay opt-in per caller, not a global default."""
    joints_list = [[float(i)] * 6 for i in range(4)]
    mock_hw = MagicMock(return_value=True)
    monkeypatch.setattr(simulate, "_send_hw_target", mock_hw)

    simulate._send_hw_path(joints_list, 30.0)  # max_points defaults to None

    assert mock_hw.call_count == 4


def test_send_hw_path_stops_early_on_stop_event(monkeypatch):
    monkeypatch.setattr(simulate, "_send_hw_target", MagicMock(return_value=True))
    joints_list = [[0.0] * 6, [1.0] * 6, [2.0] * 6]

    simulate.SIMULATION_STOP_EVENT.set()
    result = simulate._send_hw_path(joints_list, 30.0)

    assert result is False
    simulate._send_hw_target.assert_not_called()


def test_send_waypoints_uses_configured_max_points(monkeypatch):
    monkeypatch.setattr(simulate, "DRIVE_HARDWARE", True)
    monkeypatch.setattr(simulate, "_HW_DRIVE_REQUESTED", True)
    monkeypatch.setattr(simulate, "HW_MAX_WAYPOINTS_PER_SEGMENT", 2)
    monkeypatch.setattr(simulate, "_bridge", MagicMock())
    mock_hw_path = MagicMock(return_value=True)
    monkeypatch.setattr(simulate, "_send_hw_path", mock_hw_path)

    joints_list = [[float(i)] * 6 for i in range(6)]
    simulate.send_waypoints(joints_list, 30.0, dt=0.2)

    mock_hw_path.assert_called_once_with(joints_list, 30.0, max_points=2)


# ── _h_pick: arm IK target must track the calibrated profile, not the
# sim-only spawn point ──────────────────────────────────────────────────────
# Confirmed on physical hardware 2026-07-29: pick_x_rel/pick_y_rel were
# derived from OBJECT_SPAWN_X/Y - ROBOT_BASE_X/Y (module constants here that
# never switch with DRIVE_HARDWARE), so a real-cell recalibration of
# DEFAULT_PICK_X_REL/Y_REL (calibration.py, done the same day via
# testing/calibrate_rack.py) was silently ignored by the actual pick — the
# arm missed the calibrated point by ~17mm. In the sim profile the two
# formulas coincide exactly by construction, so this is invisible in
# Gazebo-only runs; only a real-cell recalibration exposes it.

def test_h_pick_ik_target_uses_calibrated_profile_not_spawn_point(monkeypatch):
    # Stand-in "recalibrated real cell" values, deliberately different from
    # OBJECT_SPAWN_X/Y - ROBOT_BASE_X/Y (-0.05/-0.28) so the two formulas are
    # distinguishable in the assertion below.
    monkeypatch.setattr(simulate, "DEFAULT_PICK_X_REL", -0.0430)
    monkeypatch.setattr(simulate, "DEFAULT_PICK_Y_REL", -0.2985)
    monkeypatch.setattr(simulate, "get_sdf_dimensions", lambda *a, **kw: (0.02, 0.02, -0.05))
    monkeypatch.setattr(simulate, "launch_wsl_ros_command", lambda *a, **kw: True)
    monkeypatch.setattr(simulate, "detach_object_from_gripper", lambda: True)
    monkeypatch.setattr(simulate, "set_object_world_pose", lambda *a, **kw: True)
    mock_pick = MagicMock()
    monkeypatch.setattr(simulate, "simulate_ros_pick", mock_pick)
    simulate._spawned_in_world.clear()
    # pick_slot_index is a persistent function attribute (cycles rack slots
    # across pick calls within one run) — pin it to slot 0 regardless of
    # what an earlier test in the suite left it at.
    simulate.simulation_recursive_blockly_parser.pick_slot_index = 0

    mock_objects = MagicMock()
    mock_objects.filter.return_value.first.return_value = None  # falls back to payload name

    code = {
        "type": "pick_block",
        "inputs": {"OBJECT": {"block": {"data": json.dumps({"id": 1, "name": "tube"})}}},
    }
    simulate.simulation_recursive_blockly_parser(code, mock_objects, [], MagicMock(), simulate_event=True)

    mock_pick.assert_called_once()
    _, kwargs = mock_pick.call_args
    assert kwargs["pick_x_rel"] == pytest.approx(-0.0430)
    assert kwargs["pick_y_rel"] == pytest.approx(-0.2985)
    simulate._spawned_in_world.clear()


# ─────────────────────────────────────────────────────────────────────────────
# Sim-time vs wall-time arrival wait (W: 2026-07-30)
# ─────────────────────────────────────────────────────────────────────────────
# Gazebo's controllers run on sim time; this process sleeps in wall time. Below
# real-time factor 1.0 (any machine without GPU acceleration) a nominal-duration
# sleep returns while the twin is still animating, and the parser starts the
# next block against an arm that hasn't arrived — seen live as an operator
# confirm prompt appearing mid-pick while the robot was visibly still moving.

def test_wait_for_sim_arrival_blocks_until_twin_reaches_target(monkeypatch):
    mock_bridge = MagicMock()
    # Twin lags: two reads short of the target, then arrives.
    mock_bridge.get_actual_joints.side_effect = [
        [0.0, 0.0, 90.0, 0.0, 0.0, 0.0, 0.0],
        [5.0, 0.0, 90.0, 0.0, 0.0, 0.0, 0.0],
        [10.0, 0.0, 90.0, 0.0, 0.0, 0.0, 0.0],
    ]
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)

    simulate._wait_for_sim_arrival([10.0, 0.0, 90.0, 0.0, 0.0, 0.0], 0)

    # Kept polling past the lagging reads instead of returning on the first one.
    assert mock_bridge.get_actual_joints.call_count == 3


def test_wait_for_sim_arrival_never_aborts_on_timeout(monkeypatch):
    """Pacing, not a safety gate: a twin that never arrives must not kill the
    run the way _verify_hw_arrival does for the real arm."""
    mock_bridge = MagicMock()
    mock_bridge.get_actual_joints.return_value = [0.0] * 7  # never reaches target
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)
    monkeypatch.setattr(simulate, "SIM_ARRIVAL_MAX_EXTRA_S", 0.3)

    simulate._wait_for_sim_arrival([90.0, 0.0, 90.0, 0.0, 0.0, 0.0], 0)

    assert not simulate.SIMULATION_STOP_EVENT.is_set()
    assert simulate._TASK_ABORT_REASON is None


def test_wait_for_sim_arrival_returns_early_without_usable_feed(monkeypatch):
    """No joint feed (or a test double) must fall straight back to the nominal
    sleep, not burn the whole extra budget polling something that can't answer."""
    mock_bridge = MagicMock()
    mock_bridge.get_actual_joints.return_value = []
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)

    simulate._wait_for_sim_arrival([90.0] * 6, 0)

    assert mock_bridge.get_actual_joints.call_count == 1


def test_wait_for_sim_arrival_stops_on_stop_event(monkeypatch):
    mock_bridge = MagicMock()
    mock_bridge.get_actual_joints.return_value = [0.0] * 7
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)
    simulate.SIMULATION_STOP_EVENT.set()

    simulate._wait_for_sim_arrival([90.0] * 6, 0)

    assert mock_bridge.get_actual_joints.call_count == 0


def test_wait_for_sim_arrival_exits_when_arm_settles_short_of_tolerance(monkeypatch):
    """The controller can stop just outside SIM_ARRIVAL_TOL_DEG (or the pose is
    unreachable). Waiting out the whole budget then buys nothing — the arm has
    stopped, which is all the caller needs. Regression for ~10s of dead time
    per segment, seen live as two sim_arrival_timeouts in one pick."""
    stuck = [50.0, 0.0, 90.0, 0.0, 0.0, 0.0, 0.0]  # 40 deg short of target, not moving
    mock_bridge = MagicMock()
    mock_bridge.get_actual_joints.return_value = stuck
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)
    monkeypatch.setattr(simulate, "SIM_ARRIVAL_MAX_EXTRA_S", 30.0)  # would hang if unused
    monkeypatch.setattr(simulate, "SIM_ARRIVAL_STILL_SAMPLES", 3)

    start = time.monotonic()
    simulate._wait_for_sim_arrival([90.0, 0.0, 90.0, 0.0, 0.0, 0.0], 0)
    elapsed = time.monotonic() - start

    assert elapsed < 5.0, "settled-but-short must not burn the full extra budget"
    assert not simulate.SIMULATION_STOP_EVENT.is_set()


def test_wait_for_sim_arrival_keeps_waiting_while_still_moving(monkeypatch):
    """A twin that is still moving must not be mistaken for a settled one."""
    moving = [[float(i), 0.0, 90.0, 0.0, 0.0, 0.0, 0.0] for i in range(0, 40, 2)]
    mock_bridge = MagicMock()
    mock_bridge.get_actual_joints.side_effect = moving
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)
    monkeypatch.setattr(simulate, "SIM_ARRIVAL_STILL_SAMPLES", 3)

    simulate._wait_for_sim_arrival([90.0, 0.0, 90.0, 0.0, 0.0, 0.0], 0)

    # Consumed every sample instead of declaring "settled" on a moving arm.
    assert mock_bridge.get_actual_joints.call_count >= len(moving)


# ─────────────────────────────────────────────────────────────────────────────
# Pick/place rack profiles vs the shared rack SDF (W: 2026-07-30)
# ─────────────────────────────────────────────────────────────────────────────
# The pick and place racks are ONE physical object, modelled by one SDF
# (locations/tube_rack/model.sdf) included statically for pick and spawned with
# yaw +90 for place. Before this the sim had 3 slots at 27mm pitch on the Y
# axis for both, matching neither the real cell (4 slots) nor any model in the
# world, and a free-standing tube tipped over and killed a run.

def test_sim_pick_and_place_racks_have_the_same_slot_geometry():
    from backend.functions import calibration
    pick = calibration._SIM_PROFILE["PICK_RACK_PROFILE"]["slot_xy_offsets"]
    place = calibration._SIM_PROFILE["LOCATION_PROFILES"]["tube_rack"]["slot_xy_offsets"]
    assert len(pick) == len(place) == 4

    def pitch(offsets):
        # Distance between consecutive slots, whichever axis they run along.
        return [round(((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5, 5)
                for a, b in zip(offsets, offsets[1:])]

    assert pitch(pick) == pitch(place), "same rack, so same slot pitch at both ends"
    assert all(abs(p - 0.02223) < 1e-4 for p in pitch(pick))


def test_rack_sdf_slot_count_and_pitch_match_the_sim_profile():
    """Guards the classic "SDF changed, calibration forgotten" split: the walls
    in the model must actually line up with the slot offsets the code aims at."""
    import xml.etree.ElementTree as ET
    from backend.functions import calibration

    sdf = os.path.join(os.path.dirname(__file__), "..", "ros2_ws", "Cobotta",
                       "locations", "tube_rack", "model.sdf")
    root = ET.parse(sdf).getroot()
    wall_x = sorted(
        float(c.find("pose").text.split()[0])
        for c in root.findall(".//collision")
        if c.get("name", "").startswith("col_wall_")
    )
    offsets = calibration._SIM_PROFILE["PICK_RACK_PROFILE"]["slot_xy_offsets"]
    assert len(wall_x) == len(offsets) + 1, "n slots need n+1 dividing walls"

    # Each slot centre must sit midway between its two walls.
    for i, (ox, _oy) in enumerate(offsets):
        centre = (wall_x[i] + wall_x[i + 1]) / 2.0
        assert abs(centre - ox) < 1e-4, f"slot {i}: wall gap centred at {centre}, profile says {ox}"


def test_rack_sdf_floor_is_thin_enough_to_not_bias_grasp_height():
    """The floor exists only so get_location_profile() detects a container.
    Anything thicker lifts every tube and silently biases every pick, whose
    grasp height is computed from the table and never consults this file."""
    import xml.etree.ElementTree as ET
    from backend.functions import calibration
    sdf = os.path.join(os.path.dirname(__file__), "..", "ros2_ws", "Cobotta",
                       "locations", "tube_rack", "model.sdf")
    root = ET.parse(sdf).getroot()
    floor = next(c for c in root.findall(".//collision")
                 if c.get("name") == "col_floor")
    thickness = float(floor.find(".//box/size").text.split()[2])
    assert thickness <= calibration.SPAWN_SETTLE_THRESHOLD_M


def test_rack_sdf_is_detected_as_a_container_for_place_z():
    """Removing the floor entirely would make is_container False and send
    resolve_place_z down the "hover above the rim" branch, dropping objects
    from the top of the 35mm walls."""
    from backend.functions import calibration
    rim, floor_h, is_container = simulate.get_location_profile("tube_rack")
    assert is_container, "place Z depends on the rack reading as a container"
    assert floor_h is not None and floor_h <= calibration.SPAWN_SETTLE_THRESHOLD_M
    assert rim > 0.03


# ─────────────────────────────────────────────────────────────────────────────
# Objects too wide for a rack slot rest ON TOP of the rack (W: 2026-07-30)
# ─────────────────────────────────────────────────────────────────────────────
# The medicine bottle is 23mm against a 20.63mm slot — it physically cannot go
# in a hole, and the operator puts it on top of the rack on the real cell. Now
# that the pick rack is a static model in the world, spawning it at slot
# coordinates without the lift buries it inside the walls.

def test_wide_object_is_lifted_to_the_rack_rim():
    from backend.functions import calibration
    assert simulate.rack_lift_for_width(0.023) == calibration.RACK_RIM_H


def test_slot_sized_object_is_not_lifted():
    assert simulate.rack_lift_for_width(0.018) == 0.0


def test_lift_boundary_is_the_slot_interior():
    from backend.functions import calibration
    w = calibration.RACK_SLOT_INNER_W
    assert simulate.rack_lift_for_width(w) == 0.0          # exactly fits
    assert simulate.rack_lift_for_width(w + 1e-4) > 0.0    # just too wide


def test_medicine_bottle_grasp_height_clears_the_rack():
    """The whole point: the gripper must descend to the bottle standing on the
    rack, not to where it would be standing on the table. Without the lift the
    grasp is a full rim-height too low and closes on empty air."""
    from backend.functions import calibration
    model = simulate.normalize_object_for_grasp("medicine_bottle")
    plan = simulate.plan_pick_for_object(model, -0.05, -0.28)
    tube_model = simulate.normalize_object_for_grasp("tube")
    tube_plan = simulate.plan_pick_for_object(tube_model, -0.05, -0.28)

    assert model.graspable_width > calibration.RACK_SLOT_INNER_W, "premise: doesn't fit a slot"
    expected = (calibration.PICK_Z_REF_OFFSET + model.grasp_center_offset
                + calibration.PICK_Z_FINE_TUNE + calibration.RACK_RIM_H)
    assert plan.z_pick == pytest.approx(expected)
    # The tube, which does fit, must be unaffected.
    assert tube_plan.z_pick == pytest.approx(
        calibration.PICK_Z_REF_OFFSET + tube_model.grasp_center_offset
        + calibration.PICK_Z_FINE_TUNE)


def test_rack_constants_match_the_shared_rack_sdf():
    """RACK_RIM_H / RACK_SLOT_INNER_W are duplicated from the SDF into
    calibration.py. Pin them, or a mesh edit silently invalidates every lift."""
    import xml.etree.ElementTree as ET
    from backend.functions import calibration

    sdf = os.path.join(os.path.dirname(__file__), "..", "ros2_ws", "Cobotta",
                       "locations", "tube_rack", "model.sdf")
    root = ET.parse(sdf).getroot()
    walls = [c for c in root.findall(".//collision")
             if c.get("name", "").startswith("col_wall_")]

    # Rim = top of a wall = pose_z + height/2.
    w0 = walls[0]
    pose_z = float(w0.find("pose").text.split()[2])
    height = float(w0.find(".//box/size").text.split()[2])
    assert calibration.RACK_RIM_H == pytest.approx(pose_z + height / 2.0)

    # Slot interior = gap between two adjacent walls' facing surfaces.
    xs = sorted(float(w.find("pose").text.split()[0]) for w in walls)
    thickness = float(w0.find(".//box/size").text.split()[0])
    assert calibration.RACK_SLOT_INNER_W == pytest.approx(xs[1] - xs[0] - thickness, abs=1e-4)
