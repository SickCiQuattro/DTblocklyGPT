"""Motion calibration profiles for the digital twin and the real Cobotta cell.

Two profiles exist:

* ``_SIM_PROFILE`` — Gazebo-tuned values. The source of truth for simulation;
  do not change these unless the simulation world geometry changes.
* ``_REAL_PROFILE`` — starts as a copy of the sim profile and overrides only the
  keys that differ on the physical cell. Calibrate with the teach pendant before
  enabling ``DRIVE_HARDWARE=1``.

``ACTIVE`` selects between them based on the DRIVE_HARDWARE environment flag.
The individual module-level constants below are what simulate.py imports.

Units:
* ``*_Z_OFFSET`` / ``*_Z_*`` / ``*_REL`` distances are in metres.
* ``*_POSE`` lists are six joint angles in degrees (J1..J6).
* ``slot_xy_offsets`` are per-slot (dx, dy) displacements in metres, relative to
  slot 0 (the single-object pick/place point). Racks aren't guaranteed to lie
  on a pure Y line — measure both axes (see testing/calibrate_rack.py `read`).
"""

import math

from backend.functions.env_utils import get_bool_env

DRIVE_HARDWARE = get_bool_env("DRIVE_HARDWARE")

# Robot base pose in the Gazebo world (worldCobotta.sdf, Cobotta include pose)
# — physical constant, same in both profiles. Source of truth for the
# TABLE_TOP_Z_ABS / PICK_Z_REF_OFFSET invariant asserted below.
ROBOT_BASE_Z: float = 1.05

# Gazebo-tuned baseline — also the template the real profile is built from.
_SIM_PROFILE = {
    "URDF_GAZEBO_Z_OFFSET": 0.085,
    # TABLE_TOP_Z_ABS is Gazebo-WORLD-absolute z (consumed directly by spawn/snap
    # RPCs). PICK_Z_REF_OFFSET is ROBOT-RELATIVE z (fed to IK; matches a real
    # CurPos.Z reading at table contact). They must satisfy:
    #   PICK_Z_REF_OFFSET == TABLE_TOP_Z_ABS - ROBOT_BASE_Z
    # 2026-07-07 measured real-cell table contact at CurPos.Z=-36.61mm — that
    # value belongs in PICK_Z_REF_OFFSET, not TABLE_TOP_Z_ABS (a robot-frame
    # measurement is not a world-frame quantity). The assert below catches
    # this class of mistake.
    "TABLE_TOP_Z_ABS": 1.0134,
    "PICK_Z_REF_OFFSET": -0.0366,
    "DEFAULT_PICK_X_REL": -0.05,
    "DEFAULT_PICK_Y_REL": -0.28,
    "DEFAULT_PLACE_X_REL": 0.20,
    "DEFAULT_PLACE_Y_REL": -0.21,
    "SAFE_INTERMEDIATE_POSE": [51.56, 20.05, 87.08, 0.0, 48.70, 0.0],
    "SCAN_POSE": [0.0, 30.0, 70.0, 0.0, 80.0, 0.0],
    "LOCATION_PROFILES": {
        # grasp_yaw (rad): gripper rotation for rack pick/place, in case fingers
        # need to turn 90° (math.pi/2) to clear adjacent tubes. 0.0 = untested
        # default — tune on real hardware if fingers hit a neighboring slot.
        "tube_rack": {"slot_xy_offsets": [(0.0, 0.0), (0.0, 0.027), (0.0, -0.027)],
                      "grasp_yaw": 0.0},
    },
    # Pick has no "location" block (it's always the rack) so it can't share
    # LOCATION_PROFILES by name — and on the real cell its offsets are NOT the
    # same as the place rack's (see _REAL_PROFILE override), so it needs its
    # own profile rather than reusing "tube_rack".
    "PICK_RACK_PROFILE": {"slot_xy_offsets": [(0.0, 0.0), (0.0, 0.027), (0.0, -0.027)],
                          "grasp_yaw": 0.0},
    "CONDITION_TIMEOUT_S": 30,
    "SPAWN_SETTLE_THRESHOLD_M": 0.001,
    "PICK_Z_FINE_TUNE": 0.0,
    # Twin-coherence guards (real hardware only). NOT YET REAL-HARDWARE-TUNED:
    # these are the original guessed values from the commit that introduced
    # them (4c8b92e) — nothing has measured real encoder jitter or real
    # gripper-slip behaviour against them. _REAL_PROFILE has never overridden
    # any of the three. Tighten/loosen here once real data exists.
    "HW_VERIFY_TOL_DEG": 2.0,
    "HW_VERIFY_TIMEOUT_S": 3.0,
    "HW_GRASP_SLIP_TOL_MM": 1.5,
}

# Real-cell profile — calibrate with the teach pendant before using DRIVE_HARDWARE=1.
# Override only the keys that differ from the sim baseline; everything else inherits.
# 2026-07-07: table-contact measurement (CurPos.Z=-36.61mm) folded into the sim
# baseline's PICK_Z_REF_OFFSET above (world SDF table pose moved to match) —
# real and sim geometry coincide for now, so no override here yet. Add one only
# for a value that genuinely differs on the physical cell (e.g. a future
# re-measurement after the cell is moved).
_REAL_PROFILE = {
    **_SIM_PROFILE,
    # Real-cell only: the wrist-mounted Canon camera looks straight down at
    # the sim SCAN_POSE's J5=80 (near-vertical wrist pitch), so YOLO only
    # ever sees the top face of an object (e.g. a tube reads as a circle,
    # not a cylinder). Lowering J5 tilts the camera toward an oblique view
    # (top+side) without moving the arm's XY position, for better class/cap-
    # colour recognition. No effect in sim — the sim detection camera is a
    # fixed world model (worldCobotta.sdf), not robot-mounted, so a wrist
    # angle change there wouldn't change what it sees anyway.
    # Measured 2026-07-27: the 2026-07-13 pose above framed the tube rack too
    # far away — YOLO couldn't isolate a tube shape at all (whole rack read as
    # one blob, best guess "fire hydrant" at 11%). Jogged closer with the
    # pendant, read back via GET /api/actual-joints-real, verified with
    # testing/scan_recognition_check.py: blue tube detected (bottle
    # conf=0.37, color=blue — clears the default 0.35 threshold), red tube
    # detected but marginal (conf=0.20, no cap-colour match, would NOT clear
    # threshold), green tube missed entirely. Distance was the dominant lever,
    # more than tilt — still needs work (framing/centering, maybe exposure)
    # before all rack slots are reliably recognized; not a validated final
    # pose yet.
    "SCAN_POSE": [0.90, -62.54, 141.04, -1.45, 57.77, -1.97],
    # Measured 2026-07-21 with testing/calibrate_rack.py `read`: slot 0 = the
    # fixed single-object point (exact by definition), slot 3 = jogged
    # carefully by hand and read back (GET /api/actual-joints-real -> FK).
    # Slots 1/2 are NOT independently measured — linearly interpolated
    # between 0 and 3 (evenly-spaced rack holes assumed; re-measure 1/2
    # directly with `read` if a real pick/place misses).
    #
    # Pick and place offsets are NOT the same rack orientation/approach —
    # pick is dominantly X (rack lies ~left-to-right in front of the arm),
    # place is dominantly Y — hence two separate profiles below instead of
    # sharing one like the sim placeholder does.
    "PICK_RACK_PROFILE": {
        "slot_xy_offsets": [
            (0.0, 0.0),
            (0.02553, 0.00080),
            (0.05107, 0.00160),
            (0.07660, 0.00240),
        ],
        # Measured 2026-07-21: fingers don't clear adjacent tubes at yaw=0 —
        # confirmed on hardware a 90° rotation is required to pick from the
        # rack. NOT yet confirmed for place (verify separately before reusing
        # this value there).
        "grasp_yaw": math.pi / 2,
    },
    "LOCATION_PROFILES": {
        "tube_rack": {
            "slot_xy_offsets": [
                (0.0, 0.0),
                (-0.00053, 0.02017),
                (-0.00107, 0.04033),
                (-0.00160, 0.06050),
            ],
            "grasp_yaw": 0.0,
        },
    },
}
# DEFAULT_PICK_X_REL/Y_REL, DEFAULT_PLACE_X_REL/Y_REL, and
# SAFE_INTERMEDIATE_POSE are still never overridden here — none of these have
# ever been jogged/measured on the physical cell; they all still silently
# inherit the sim-tuned value. Real-hardware runs work only insofar as the
# sim geometry happens to approximate the physical cell closely enough.

# Guard against a profile drifting out of sync with the baseline key set.
assert _SIM_PROFILE.keys() == _REAL_PROFILE.keys(), (
    "calibration profiles must expose the same keys: "
    f"{_SIM_PROFILE.keys() ^ _REAL_PROFILE.keys()}"
)

# Guard against the exact 2026-07-07 mistake: a robot-frame Z measurement
# written into the world-frame key (or vice versa). TABLE_TOP_Z_ABS is
# Gazebo-world-absolute; PICK_Z_REF_OFFSET is robot-relative — see the
# _SIM_PROFILE comment above.
for _label, _p in (("sim", _SIM_PROFILE), ("real", _REAL_PROFILE)):
    assert abs(_p["PICK_Z_REF_OFFSET"] - (_p["TABLE_TOP_Z_ABS"] - ROBOT_BASE_Z)) < 1e-6, (
        f"{_label} profile violates PICK_Z_REF_OFFSET == TABLE_TOP_Z_ABS - ROBOT_BASE_Z "
        f"(TABLE_TOP_Z_ABS is Gazebo-WORLD z, PICK_Z_REF_OFFSET is ROBOT-frame z)."
    )
del _label, _p

ACTIVE = _REAL_PROFILE if DRIVE_HARDWARE else _SIM_PROFILE

URDF_GAZEBO_Z_OFFSET: float = ACTIVE["URDF_GAZEBO_Z_OFFSET"]
TABLE_TOP_Z_ABS: float = ACTIVE["TABLE_TOP_Z_ABS"]
PICK_Z_REF_OFFSET: float = ACTIVE["PICK_Z_REF_OFFSET"]
DEFAULT_PICK_X_REL: float = ACTIVE["DEFAULT_PICK_X_REL"]
DEFAULT_PICK_Y_REL: float = ACTIVE["DEFAULT_PICK_Y_REL"]
DEFAULT_PLACE_X_REL: float = ACTIVE["DEFAULT_PLACE_X_REL"]
DEFAULT_PLACE_Y_REL: float = ACTIVE["DEFAULT_PLACE_Y_REL"]
SAFE_INTERMEDIATE_POSE: list = ACTIVE["SAFE_INTERMEDIATE_POSE"]
SCAN_POSE: list = ACTIVE["SCAN_POSE"]
LOCATION_PROFILES: dict = ACTIVE["LOCATION_PROFILES"]
PICK_RACK_PROFILE: dict = ACTIVE["PICK_RACK_PROFILE"]
CONDITION_TIMEOUT_S: int = ACTIVE["CONDITION_TIMEOUT_S"]
SPAWN_SETTLE_THRESHOLD_M: float = ACTIVE["SPAWN_SETTLE_THRESHOLD_M"]
PICK_Z_FINE_TUNE: float = ACTIVE["PICK_Z_FINE_TUNE"]
HW_VERIFY_TOL_DEG: float = ACTIVE["HW_VERIFY_TOL_DEG"]
HW_VERIFY_TIMEOUT_S: float = ACTIVE["HW_VERIFY_TIMEOUT_S"]
HW_GRASP_SLIP_TOL_MM: float = ACTIVE["HW_GRASP_SLIP_TOL_MM"]
