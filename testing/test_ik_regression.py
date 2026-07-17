#!/usr/bin/env python3
"""
IK regression tests — offline (no Gazebo required).

Run with:
    poetry run python -m pytest testing/test_ik_regression.py -v

Live end-to-end mode (requires running sim):
    poetry run python testing/test_ik_regression.py
"""
import sys
import os

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Configure minimal Django settings so backend imports work without a full server
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
try:
    import django
    django.setup()
except Exception:
    pass

from backend.functions.simulate import (
    COBOTTA_CHAIN,
    URDF_GAZEBO_Z_OFFSET,
    PICK_Z_REF_OFFSET,
    IK_POS_TOL,
    IK_AXIS_TOL_DEG,
    CARRY_Z_MAX,
    CARRY_Z_MIN,
    solve_gazebo_ik,
    fk_position_error,
    build_vertical_ik_path,
    _reachable_place_carry_z,
)

import math
import numpy as np

CHAIN_AVAILABLE = COBOTTA_CHAIN is not None

skip_no_chain = pytest.mark.skipif(not CHAIN_AVAILABLE, reason="COBOTTA_CHAIN not initialized — URDF not found")


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def assert_ik(x, y, z, label="", yaw=0.0, seed=None):
    """Assert IK succeeds and FK residual is within tolerance."""
    q = solve_gazebo_ik(x, y, z, grasp_yaw=yaw, seed_joints=seed)
    assert q is not None, f"IK returned None for {label} (x={x:.3f} y={y:.3f} z={z:.3f})"
    target = np.array([-y, x, z + URDF_GAZEBO_Z_OFFSET])
    pos_err, axis_err = fk_position_error(q, target)
    assert pos_err <= IK_POS_TOL, (
        f"{label}: FK pos_err={pos_err*1000:.2f}mm > {IK_POS_TOL*1000:.0f}mm"
    )
    assert axis_err <= IK_AXIS_TOL_DEG, (
        f"{label}: FK axis_err={axis_err:.2f}° > {IK_AXIS_TOL_DEG:.1f}°"
    )
    return q


# ─────────────────────────────────────────────────────────────────────────────
# Flask scenarios
# ─────────────────────────────────────────────────────────────────────────────

# z_pick = PICK_Z_REF_OFFSET + height/2 (flask height 0.076m, height/2=0.038) —
# derived from the calibration constant so this tracks _REAL_PROFILE/_SIM_PROFILE
# instead of embedding a value that goes stale the next time the cell is calibrated.
_FLASK_Z_PICK = PICK_Z_REF_OFFSET + 0.038

FLASK_SCENARIOS = [
    ("flask_nominal",  -0.05, -0.28, _FLASK_Z_PICK),
    ("flask_+1cm_X",   -0.04, -0.28, _FLASK_Z_PICK),
    ("flask_-1cm_X",   -0.06, -0.28, _FLASK_Z_PICK),
    ("flask_+1cm_Y",   -0.05, -0.27, _FLASK_Z_PICK),
    ("flask_-1cm_Y",   -0.05, -0.29, _FLASK_Z_PICK),
]


@skip_no_chain
@pytest.mark.parametrize("label,x,y,z_pick", FLASK_SCENARIOS)
def test_flask_pick_ik(label, x, y, z_pick):
    z_approach = z_pick + 0.12
    q_app = assert_ik(x, y, z_approach, label=f"{label}/approach")
    assert_ik(x, y, z_pick, label=f"{label}/pick", seed=q_app)


# ─────────────────────────────────────────────────────────────────────────────
# Pill scenarios (fixed SDF: r=0.0075, l=0.015 → z_pick = -0.01 + 0.0075)
# ─────────────────────────────────────────────────────────────────────────────

@skip_no_chain
def test_pill_pick_ik():
    # z_pick = PICK_Z_REF_OFFSET + radius (pill r=0.0075, l=0.015)
    x, y, z_pick = -0.05, -0.28, PICK_Z_REF_OFFSET + 0.0075
    z_approach = z_pick + 0.12
    z_pregrasp = z_pick + 0.02
    q_app = assert_ik(x, y, z_approach, label="pill/approach")
    q_pre = assert_ik(x, y, z_pregrasp, label="pill/pregrasp", seed=q_app)
    assert_ik(x, y, z_pick, label="pill/pick", seed=q_pre)


# ─────────────────────────────────────────────────────────────────────────────
# Tube rack insertion — 3 slots along model-X (mapped to Gazebo Y by +90° spawn yaw)
# Slot centres in robot-relative coords: x=0.20, y ∈ {-0.237, -0.21, -0.183}
# z_insert = PICK_Z_REF_OFFSET + (floor_height + 3mm clearance + z_grip); the
# geometry-only term (0.083) is fixed by the tube_rack SDF + object height,
# offset tracks the calibration profile so this doesn't go stale like the
# hardcoded value it replaced.
# ─────────────────────────────────────────────────────────────────────────────

_RACK_Z_PLACE = PICK_Z_REF_OFFSET + 0.083

RACK_SLOTS = [
    ("slot_left",   0.20, -0.237, _RACK_Z_PLACE),
    ("slot_centre", 0.20, -0.210, _RACK_Z_PLACE),
    ("slot_right",  0.20, -0.183, _RACK_Z_PLACE),
]


@skip_no_chain
@pytest.mark.parametrize("label,x,y,z_place", RACK_SLOTS)
def test_rack_insert_ik(label, x, y, z_place):
    z_up = z_place + 0.12
    q_up = assert_ik(x, y, z_up, label=f"rack_{label}/above")
    assert_ik(x, y, z_place, label=f"rack_{label}/insert", seed=q_up)


# ─────────────────────────────────────────────────────────────────────────────
# Vertical path tests — checks path non-None and every waypoint FK within tol
# ─────────────────────────────────────────────────────────────────────────────

@skip_no_chain
def test_pill_vertical_approach_path():
    x, y = -0.05, -0.28
    z_pick = PICK_Z_REF_OFFSET + 0.0075
    z_approach, z_pregrasp = z_pick + 0.12, z_pick + 0.02
    q_app = solve_gazebo_ik(x, y, z_approach)
    assert q_app is not None, "Approach IK failed — cannot test path"
    path = build_vertical_ik_path(x, y, z_approach, z_pregrasp, 0.0, q_app, n=8)
    assert path is not None, "build_vertical_ik_path returned None for pill approach"
    assert len(path) == 8
    for i, q in enumerate(path):
        z_i = z_approach + (z_pregrasp - z_approach) * i / 7
        target = np.array([-y, x, z_i + URDF_GAZEBO_Z_OFFSET])
        pos_err, _ = fk_position_error(q, target)
        assert pos_err <= IK_POS_TOL * 2, (
            f"Vertical path waypoint {i}: pos_err={pos_err*1000:.2f}mm (2× tol)"
        )


@skip_no_chain
def test_rack_insert_vertical_path():
    x, y, z_place = 0.20, -0.210, _RACK_Z_PLACE
    z_up = z_place + 0.12
    q_up = solve_gazebo_ik(x, y, z_up)
    assert q_up is not None, "Above-rack IK failed — cannot test path"
    path = build_vertical_ik_path(x, y, z_up, z_place, 0.0, q_up, n=10)
    assert path is not None, "build_vertical_ik_path returned None for rack insertion"
    assert len(path) == 10


# ─────────────────────────────────────────────────────────────────────────────
# Gantry-transit z-sweep — documents the IK-reliable height band for the
# z-adaptive heuristic seed (_heuristic_seed_j235). Physical session
# 2026-07-07 found the OLD fixed seed failed non-monotonically around
# z_carry≈0.25 (OK 0.22-0.23, FAIL 0.24, OK 0.25, FAIL ≥0.26).
#
# 0.15-0.24 is asserted here as the reliable band (verified monotonic for both
# sites with the new seed — a real improvement over the old non-monotonic
# 0.15-0.23-with-gaps). Above ~0.25 an offline grid search over j2/j3/j5 found
# NO seed posture that reliably converges for this arm geometry at these XY
# sites — that's a solver/geometry limit, not a seed-tuning gap, which is why
# CARRY_Z_MAX clamps transit height at 0.23 rather than chasing a "better"
# anchor further up. A hole appearing INSIDE 0.15-0.24 means the anchors
# regressed; failures only above 0.24 are the known, accepted limit (handled
# by the place hard-gates aborting cleanly instead of faking a place).
# ─────────────────────────────────────────────────────────────────────────────

_TRANSIT_XY_SITES = [
    ("pick_site", -0.05, -0.28),
    ("place_site", 0.20, -0.21),
]


@skip_no_chain
@pytest.mark.parametrize("site_label,x,y", _TRANSIT_XY_SITES)
@pytest.mark.parametrize("z", [round(0.15 + 0.01 * i, 2) for i in range(10)])
def test_transit_z_sweep(z, site_label, x, y):
    assert_ik(x, y, z, label=f"transit_sweep/{site_label}/z={z:.2f}")


@skip_no_chain
@pytest.mark.parametrize("site_label,x,y", _TRANSIT_XY_SITES)
def test_transit_band_covers_carry_heights(site_label, x, y):
    """Tripwire: if CARRY_Z_MAX is ever raised, this must still pass — otherwise
    the place-path clamp (simulate.py) is claiming a height IK can't reliably
    reach and the hard place gates (J3c) will start aborting real tasks."""
    assert_ik(x, y, CARRY_Z_MAX, label=f"carry_z_max/{site_label}")


# ─────────────────────────────────────────────────────────────────────────────
# Slot-2 transit ceiling — the tube rack's outer slot (x=0.20, y=-0.237, the
# farthest from the arm's centerline) is NOT reachable at the standard
# z_carry=0.213 that CARRY_MARGIN produces for a repeat() pick+place cycle,
# even though the other two slots (y=-0.21, y=-0.183) are. A dense j2/j3/j5
# grid search at (0.20,-0.237,0.213) found no posture better than 5.74mm FK
# residual — this is a real reach-envelope limit, not a seed-tuning gap.
# _reachable_place_carry_z (simulate.py) steps z_carry down until it finds a
# height this specific slot can reach. These tests pin the measured ceiling
# so a regression here is caught before it starts aborting live place runs
# on the rack's outer slot (see live session 2026-07-10, tasks 108/109).
# ─────────────────────────────────────────────────────────────────────────────

_SLOT2_X, _SLOT2_Y = 0.20, -0.237


@skip_no_chain
def test_slot2_transit_ceiling():
    assert solve_gazebo_ik(_SLOT2_X, _SLOT2_Y, 0.213) is None, (
        "slot2 unexpectedly reachable at z=0.213 — if this now passes, the "
        "arm/seed geometry changed and _reachable_place_carry_z's lowering "
        "may no longer be necessary (but leaving it is harmless: the first "
        "probe at the unclamped z_carry would just succeed immediately)"
    )
    assert solve_gazebo_ik(_SLOT2_X, _SLOT2_Y, 0.20) is not None, (
        "slot2 regressed below its measured reachable ceiling (z=0.20) — "
        "_reachable_place_carry_z would have nowhere to land"
    )


@skip_no_chain
def test_reachable_place_carry_z_lowers_far_slot():
    seed = solve_gazebo_ik(-0.05, -0.28, 0.183)
    assert seed is not None, "pick-carry seed IK failed — cannot test the helper"

    z = _reachable_place_carry_z(_SLOT2_X, _SLOT2_Y, 0.213, CARRY_Z_MIN, 0.0, seed)
    assert z < 0.213, "helper did not lower z_carry for the unreachable outer slot"
    assert z >= CARRY_Z_MIN
    assert solve_gazebo_ik(_SLOT2_X, _SLOT2_Y, z, seed_joints=seed) is not None, (
        "helper returned a height that doesn't actually solve"
    )


@skip_no_chain
def test_reachable_place_carry_z_leaves_near_slots_unchanged():
    seed = solve_gazebo_ik(-0.05, -0.28, 0.183)
    assert seed is not None, "pick-carry seed IK failed — cannot test the helper"

    for y in (-0.210, -0.183):
        z = _reachable_place_carry_z(0.20, y, 0.213, CARRY_Z_MIN, 0.0, seed)
        assert z == 0.213, f"helper touched z_carry for a slot that already reaches (y={y})"


@skip_no_chain
def test_reachable_place_carry_z_gives_up_at_floor():
    """An unreachable-everywhere target (way outside the workspace) must return
    z_carry unchanged rather than loop forever or land on a non-solving height —
    the transit build downstream is the one that aborts on this, cleanly."""
    z = _reachable_place_carry_z(5.0, 5.0, 0.213, CARRY_Z_MIN, 0.0, None)
    assert z == 0.213


# URDF ↔ SDF forward-kinematics cross-check (offline). IK runs on cobotta_ik.urdf,
# Gazebo physics on Cobotta.sdf — two independent descriptions. Feed the same joint
# vector to an independent FK of each and assert the link_j6 origin agrees, after the
# fixed base-frame map urdf = (-gz_y, gz_x, gz_z). No z offset: URDF_GAZEBO_Z_OFFSET
# (0.085) is a TCP→fingertip tool length, not a model reconciliation. Guards against
# the IK URDF desyncing from the sim SDF (current agreement ≤2.5mm).

FK_XCHECK_TOL = 0.004  # 4 mm (current max ≈2.5mm + margin)


def _rpy_to_R(roll, pitch, yaw):
    """SDF/URDF RPY convention: R = Rz(yaw) Ry(pitch) Rx(roll)."""
    cx, sx = math.cos(roll), math.sin(roll)
    cy, sy = math.cos(pitch), math.sin(pitch)
    cz, sz = math.cos(yaw), math.sin(yaw)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


def _pose_T(x, y, z, roll, pitch, yaw):
    T = np.eye(4)
    T[:3, :3] = _rpy_to_R(roll, pitch, yaw)
    T[:3, 3] = [x, y, z]
    return T


def _axis_T(axis, q):
    """Homogeneous rotation by q (rad) about unit axis (Rodrigues)."""
    a = np.array(axis, dtype=float)
    a /= np.linalg.norm(a)
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    T = np.eye(4)
    T[:3, :3] = np.eye(3) + math.sin(q) * K + (1 - math.cos(q)) * (K @ K)
    return T


# SDF kinematic chain from Cobotta.sdf: per joint
#   (joint pose rel parent link), (joint axis), (child link pose rel joint)
_SDF_CHAIN = [
    (_pose_T(0, 0, 0.108, 0, 0, 0),                          (0, 0, 1),  _pose_T(0, 0, 0, 0, 0, 0)),
    (_pose_T(0.062, 0, 0.072, 3.14159, 1.57079, 3.14159),    (0, 0, 1),  _pose_T(0, 0, 0, 0, 0, 0)),
    (_pose_T(-0.165, 0, 0, 3.14159, 0, 3.14159),             (0, 0, -1), _pose_T(0, 0, 0, 0, 0, 1.57)),
    (_pose_T(0.012, -0.088, 0.042, -1.57079, 1.57079, 3.14159), (0, 0, 1), _pose_T(0, 0, 0, 0, 0, 0)),
    (_pose_T(-0.042, 0, 0.089, -1.5708, 0, 1.5708),          (0, 0, -1), _pose_T(0, 0, 0, 0, 0, 0)),
    (_pose_T(0, -0.04, 0.0225, -1.57079, 1.57079, 3.14159),  (0, 0, 1),  _pose_T(0, 0, 0, 0, 0, 0)),
]


def _sdf_fk_linkj6(q_deg):
    """link_j6 origin in the SDF link_root (Gazebo robot base) frame."""
    M = np.eye(4)
    for (Tj, axis, Tl), qd in zip(_SDF_CHAIN, q_deg):
        M = M @ Tj @ _axis_T(axis, math.radians(qd)) @ Tl
    return M[:3, 3]


def _urdf_fk_linkj6(q_deg):
    """link_j6 / joint_hand origin in the URDF base_link frame (via ikpy chain)."""
    joints_full = [0.0] * len(COBOTTA_CHAIN.links)
    name_to_idx = {f"joint{i + 1}": i for i in range(6)}
    for i, link in enumerate(COBOTTA_CHAIN.links):
        if link.name in name_to_idx:
            joints_full[i] = math.radians(q_deg[name_to_idx[link.name]])
    return COBOTTA_CHAIN.forward_kinematics(joints_full)[:3, 3]


FK_XCHECK_CONFIGS = [
    ("zero",       [0, 0, 0, 0, 0, 0]),
    ("home_j3=90", [0, 0, 90, 0, 0, 0]),
    ("scan",       [0, 30, 70, 0, 80, 0]),
    ("safe_inter", [51.56, 20.05, 87.08, 0.0, 48.70, 0.0]),
    ("mix1",       [20, 10, 100, -30, 60, 45]),
    ("mix2",       [-40, -20, 120, 90, -30, -60]),
]


@skip_no_chain
@pytest.mark.parametrize("label,q", FK_XCHECK_CONFIGS)
def test_urdf_sdf_fk_consistency(label, q):
    p_urdf = _urdf_fk_linkj6(q)
    p_sdf = _sdf_fk_linkj6(q)
    # map SDF (gazebo base) → URDF base frame: 90° yaw, shared z datum
    p_sdf_in_urdf = np.array([-p_sdf[1], p_sdf[0], p_sdf[2]])
    resid = float(np.linalg.norm(p_urdf - p_sdf_in_urdf))
    assert resid <= FK_XCHECK_TOL, (
        f"{label}: URDF vs SDF FK disagree by {resid * 1000:.2f}mm "
        f"> {FK_XCHECK_TOL * 1000:.0f}mm — IK URDF and sim SDF have desynced"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Live end-to-end mode (requires running Gazebo + Flask bridge)
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import time
    from backend.functions.simulate import (
        simulate_ros_initial_position,
        debug_fk,
    )

    print("=" * 60)
    print(" IK REGRESSION — LIVE MODE (requires running sim)")
    print("=" * 60)

    if not CHAIN_AVAILABLE:
        print("ERROR: COBOTTA_CHAIN is None. Check URDF path.")
        sys.exit(1)

    simulate_ros_initial_position()
    time.sleep(2.0)

    scenarios = [
        ("flask nominal", -0.05, -0.28, _FLASK_Z_PICK),
        ("pill nominal",  -0.05, -0.28, PICK_Z_REF_OFFSET + 0.0075),
        ("rack slot 0",    0.20, -0.237, _RACK_Z_PLACE),
        ("rack slot 1",    0.20, -0.210, _RACK_Z_PLACE),
        ("rack slot 2",    0.20, -0.183, _RACK_Z_PLACE),
    ]

    for label, x, y, z in scenarios:
        print(f"\n--- {label} ---")
        q = solve_gazebo_ik(x, y, z)
        if q:
            debug_fk(q, label=label)
        else:
            print(f"  IK FAILED")
