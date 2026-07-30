#!/usr/bin/env python3
"""Rack calibration helper — pick & place of 4 tubes from the tube_rack.

Workflow (see plan): the single-object pick/place point is slot 0
(DEFAULT_PICK/PLACE_X_REL/Y_REL). The rack is butted up against that point;
jog the arm by hand to the remaining slot positions and use `read` to log
the delta each time.

Run with hardware armed (env var must be set BEFORE the process starts —
calibration.py reads it at import time):

    DRIVE_HARDWARE=1 poetry run python testing/calibrate_rack.py read
    DRIVE_HARDWARE=1 poetry run python testing/calibrate_rack.py read --ref place
    DRIVE_HARDWARE=1 poetry run python testing/calibrate_rack.py goto-pick --slot 0
    DRIVE_HARDWARE=1 poetry run python testing/calibrate_rack.py goto-place --slot 1
    DRIVE_HARDWARE=1 poetry run python testing/calibrate_rack.py goto-guide
    poetry run python testing/calibrate_rack.py verify-coords          # read-only, no hardware needed
    poetry run python testing/calibrate_rack.py --selftest   # offline, no hardware

`read`/`goto-*` never move blind: goto-pick/goto-place stop at a hover height
above the grasp point (never at grasp height), goto-guide only replays a pose
you already jogged and confirmed by eye. `verify-coords` never moves anything
at all (pure IK/FK arithmetic) — run it first, before touching the arm, to
catch a coordinate-formula drift between this tool and the real pick/place
code in one pass (see resolve_place_z's docstring in simulate.py for the
specific place-Z divergence this was built to catch, found 2026-07-29).
Keep the teach-pendant e-stop in reach for every command that does move.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

import django  # noqa: E402
django.setup()

from backend.functions import calibration  # noqa: E402
from backend.functions import simulate as sim  # noqa: E402


def _tcp_rel(joints_deg):
    """FK on a 6-value joint pose (degrees) -> (x_rel, y_rel, z_rel), robot-relative
    metres — same frame as DEFAULT_PICK_X_REL/Y_REL and solve_gazebo_ik's inputs."""
    import math
    chain = sim.COBOTTA_CHAIN
    joints_full = [0.0] * len(chain.links)
    for i, link in enumerate(chain.links):
        name = link.name
        if name.startswith("joint") and name[5:].isdigit():
            idx = int(name[5:]) - 1
            if 0 <= idx < 6:
                joints_full[i] = math.radians(joints_deg[idx])
    T = chain.forward_kinematics(joints_full)
    x_urdf, y_urdf, z_urdf = T[:3, 3]
    return y_urdf, -x_urdf, z_urdf - sim.URDF_GAZEBO_Z_OFFSET


def _read_real_joints():
    """Read the physical arm's current joints. Aborts with a clear message if
    hardware isn't armed/reachable — this command is read-only either way."""
    sim._HW_DRIVE_REQUESTED = True
    if not calibration.DRIVE_HARDWARE:
        print("DRIVE_HARDWARE not set — export DRIVE_HARDWARE=1 before running.")
        sys.exit(1)
    joints = sim._bridge.get_actual_joints_real()
    if len(joints) < 6:
        print("No real joint feed (cobotta_node not connected?) — nothing to read.")
        sys.exit(1)
    return list(joints[:6])


def cmd_read(args):
    joints = _read_real_joints()
    x_rel, y_rel, z_rel = _tcp_rel(joints)

    if args.ref == "pick":
        ref_x, ref_y = calibration.DEFAULT_PICK_X_REL, calibration.DEFAULT_PICK_Y_REL
    else:
        ref_x, ref_y = calibration.DEFAULT_PLACE_X_REL, calibration.DEFAULT_PLACE_Y_REL

    print(f"joints (deg): {[round(v, 2) for v in joints]}")
    print(f"x_rel={x_rel:.4f}  y_rel={y_rel:.4f}  z_rel={z_rel:.4f}")
    print(f"delta vs slot 0 ({args.ref}): dx={x_rel - ref_x:+.4f}  dy={y_rel - ref_y:+.4f}")
    print("-> slot_y_offsets entry: {:.4f}".format(y_rel - ref_y))
    if abs(x_rel - ref_x) > 0.003:
        print(f"!! dx={x_rel - ref_x:+.4f}m is not negligible — Y-only slot_y_offsets "
              f"may not be enough, consider (dx,dy) per slot.")


def _goto_hover(x_rel, y_rel, z_pick, z_hover, grasp_yaw):
    if not sim.sync_current_state_from_ros():
        print("WARNING: could not sync from ROS — seeding IK from last known state.")
    current_joints, _ = sim.get_current_state()

    z_top = z_pick + 0.10
    q_approach = sim.solve_gazebo_ik(x_rel, y_rel, z_top, grasp_yaw, seed_joints=current_joints)
    if not q_approach:
        print(f"IK failed at approach height z={z_top:.3f}"); sys.exit(1)
    print(f"-> approach z={z_top:.3f}")
    sim.smooth_move(q_approach, sim.ROS_OPEN_GRIPPER, duration_s=2.0)

    z_target = z_pick + z_hover
    q_hover = sim.solve_gazebo_ik(x_rel, y_rel, z_target, grasp_yaw, seed_joints=q_approach)
    if not q_hover:
        print(f"IK failed at hover height z={z_target:.3f}"); sys.exit(1)
    print(f"-> hover z={z_target:.3f} (z_pick={z_pick:.3f} + {z_hover:.3f}), gripper open, holding here")
    sim.smooth_move(q_hover, sim.ROS_OPEN_GRIPPER, duration_s=1.5)


def _slot_offset(slot, rack, label):
    offsets = rack.get("slot_xy_offsets", [(0.0, 0.0)])
    if slot >= len(offsets):
        print(f"slot {slot} not calibrated yet — only {len(offsets)} slot(s) in "
              f"{label}['slot_xy_offsets']. Jog there and use `read` first, "
              f"then add the value to calibration.py.")
        sys.exit(1)
    dx, dy = offsets[slot]
    return dx, dy, rack.get("grasp_yaw", 0.0)


def cmd_goto_pick(args):
    dx, dy, grasp_yaw = _slot_offset(args.slot, calibration.PICK_RACK_PROFILE, "PICK_RACK_PROFILE")
    x_rel = calibration.DEFAULT_PICK_X_REL + dx
    y_rel = calibration.DEFAULT_PICK_Y_REL + dy
    model = sim.normalize_object_for_grasp("tube")
    plan = sim.plan_pick_for_object(model, x_rel, y_rel)
    if not plan.feasible:
        print(f"tube grasp plan infeasible: {plan.reason}"); sys.exit(1)
    _goto_hover(x_rel, y_rel, plan.z_pick, args.z_hover, grasp_yaw)


def cmd_goto_place(args):
    rack = calibration.LOCATION_PROFILES.get("tube_rack", {})
    dx, dy, grasp_yaw = _slot_offset(args.slot, rack, "LOCATION_PROFILES['tube_rack']")
    x_rel = calibration.DEFAULT_PLACE_X_REL + dx
    y_rel = calibration.DEFAULT_PLACE_Y_REL + dy
    # Same formula simulate_ros_place uses (container detection + the
    # object-height-dependent grip offset included) — this used to be a
    # simpler, separately-derived approximation that didn't match what a
    # real place actually targets (found 2026-07-29). --height lets you
    # check a different object than the default tube (0.10m).
    z_place = sim.resolve_place_z("tube_rack", args.height)
    _goto_hover(x_rel, y_rel, z_place, args.z_hover, grasp_yaw)


def _verify_row(slot, x_rel, y_rel, z, yaw):
    q = sim.solve_gazebo_ik(x_rel, y_rel, z, yaw)
    if not q:
        print(f"{slot:<6}{x_rel:>9.4f}{y_rel:>9.4f}{z:>9.4f}{yaw:>8.3f}{'FAIL':>7}{'--':>12}")
        return
    x2, y2, z2 = _tcp_rel(q)
    err_mm = ((x2 - x_rel) ** 2 + (y2 - y_rel) ** 2 + (z2 - z) ** 2) ** 0.5 * 1000
    print(f"{slot:<6}{x_rel:>9.4f}{y_rel:>9.4f}{z:>9.4f}{yaw:>8.3f}{'OK':>7}{err_mm:>12.2f}")


def cmd_verify_coords(args):
    """Read-only, no hardware and no movement (pure IK/FK arithmetic): prints
    the exact x_rel/y_rel/z every pick and place slot targets in real
    execution (_h_pick/simulate_ros_place), plus the IK solution and its FK
    round-trip error. Run this BEFORE moving the real arm to catch a
    coordinate-formula drift between this tool and the real pick/place code
    in one pass, instead of discovering it one slot at a time on hardware —
    see resolve_place_z's docstring (simulate.py) for the specific
    place-Z divergence this exists to catch (found 2026-07-29)."""
    header = f"{'slot':<6}{'x_rel':>9}{'y_rel':>9}{'z':>9}{'yaw':>8}{'IK':>7}{'FK err(mm)':>12}"

    print(f"-- PICK ({args.pick_object}) — same formula as _h_pick/simulate_ros_pick --")
    print(header)
    model = sim.normalize_object_for_grasp(args.pick_object)
    pick_offsets = calibration.PICK_RACK_PROFILE.get("slot_xy_offsets", [(0.0, 0.0)])
    pick_yaw = calibration.PICK_RACK_PROFILE.get("grasp_yaw", 0.0)
    for slot, (dx, dy) in enumerate(pick_offsets):
        x_rel = calibration.DEFAULT_PICK_X_REL + dx
        y_rel = calibration.DEFAULT_PICK_Y_REL + dy
        plan = sim.plan_pick_for_object(model, x_rel, y_rel)
        if not plan.feasible:
            print(f"{slot:<6} infeasible: {plan.reason}")
            continue
        _verify_row(slot, x_rel, y_rel, plan.z_pick, pick_yaw)

    print(f"\n-- PLACE (tube_rack, height={args.height}m) — same formula as simulate_ros_place --")
    print(header)
    rack = calibration.LOCATION_PROFILES.get("tube_rack", {})
    place_offsets = rack.get("slot_xy_offsets", [(0.0, 0.0)])
    place_yaw = rack.get("grasp_yaw", 0.0)
    z_place = sim.resolve_place_z("tube_rack", args.height)
    for slot, (dx, dy) in enumerate(place_offsets):
        x_rel = calibration.DEFAULT_PLACE_X_REL + dx
        y_rel = calibration.DEFAULT_PLACE_Y_REL + dy
        _verify_row(slot, x_rel, y_rel, z_place, place_yaw)

    if calibration.DEFAULT_PLACE_X_REL == calibration._SIM_PROFILE["DEFAULT_PLACE_X_REL"] and calibration.DRIVE_HARDWARE:
        print("\n!! DRIVE_HARDWARE=1 but DEFAULT_PLACE_X_REL/Y_REL still equal the sim profile's "
              "value — the real cell's place point has never been measured (see calibration.py "
              "_REAL_PROFILE comment). The place coordinates above are a sim guess, not a "
              "calibrated real-cell target.")


def cmd_goto_guide(args):
    guide_pose = calibration.ACTIVE.get("GUIDE_POSE")
    if not guide_pose:
        print("No GUIDE_POSE saved yet. Jog the gripper near-table by hand, run "
              "`read`, then add the 6 joints as GUIDE_POSE in calibration.py.")
        sys.exit(1)
    print(f"-> transit via SAFE_INTERMEDIATE_POSE, then GUIDE_POSE={guide_pose}")
    sim.smooth_move(list(calibration.SAFE_INTERMEDIATE_POSE), sim.ROS_OPEN_GRIPPER, duration_s=2.0)
    sim.smooth_move(list(guide_pose), sim.ROS_OPEN_GRIPPER, duration_s=2.0)


def selftest():
    """Offline FK/IK round-trip on DEFAULT_PICK — no hardware, catches frame-math regressions."""
    x, y, z = calibration.DEFAULT_PICK_X_REL, calibration.DEFAULT_PICK_Y_REL, 0.05
    q = sim.solve_gazebo_ik(x, y, z, 0.0)
    assert q, "IK failed on DEFAULT_PICK — chain broken?"
    x2, y2, z2 = _tcp_rel(q)
    assert abs(x2 - x) < 0.002 and abs(y2 - y) < 0.002 and abs(z2 - z) < 0.002, (
        f"FK/IK round-trip drifted: wanted ({x},{y},{z}) got ({x2:.4f},{y2:.4f},{z2:.4f})")
    print("selftest OK: FK/IK round-trip on DEFAULT_PICK within 2mm")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--selftest", action="store_true", help="offline FK/IK check, no hardware")
    sub = parser.add_subparsers(dest="command")

    p_read = sub.add_parser("read", help="read real joints -> x/y/z_rel + delta vs slot 0")
    p_read.add_argument("--ref", choices=["pick", "place"], default="pick")

    p_pick = sub.add_parser("goto-pick", help="hover above a pick slot (gripper open)")
    p_pick.add_argument("--slot", type=int, default=0)
    p_pick.add_argument("--z-hover", type=float, default=0.03)

    p_place = sub.add_parser("goto-place", help="hover above a place slot (gripper open)")
    p_place.add_argument("--slot", type=int, default=0)
    p_place.add_argument("--z-hover", type=float, default=0.03)
    p_place.add_argument(
        "--height", type=float, default=0.10,
        help="object height in metres, for the place Z formula (default: plain tube, 0.10m)")

    sub.add_parser("goto-guide", help="replay the saved near-table rack-alignment pose")

    p_verify = sub.add_parser(
        "verify-coords",
        help="read-only, no movement: print every pick/place slot's target x/y/z + IK/FK check")
    p_verify.add_argument("--pick-object", default="tube")
    p_verify.add_argument(
        "--height", type=float, default=0.10,
        help="object height in metres, for the place Z formula (default: plain tube, 0.10m)")

    args = parser.parse_args()

    if args.selftest:
        selftest()
        return
    if args.command == "verify-coords":
        # Pure IK/FK arithmetic — no bridge/hardware call at all, so unlike
        # every other command here it must not require DRIVE_HARDWARE.
        cmd_verify_coords(args)
        return

    # Required alongside DRIVE_HARDWARE (env) for _hw_drive_active() to be
    # true — without it every real-arm call in simulate.py silently no-ops
    # and only the Gazebo twin moves. Only set for commands that actually
    # touch the bridge/hardware (everything below).
    sim._HW_DRIVE_REQUESTED = True

    if args.command == "read":
        cmd_read(args)
    elif args.command == "goto-pick":
        cmd_goto_pick(args)
    elif args.command == "goto-place":
        cmd_goto_place(args)
    elif args.command == "goto-guide":
        cmd_goto_guide(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
