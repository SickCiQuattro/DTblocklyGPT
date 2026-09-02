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

Known open gaps on the real cell (documented at each site below, not fixed —
they need a physical measurement session, not a guess):
* ``_REAL_PROFILE`` never overrides ``DEFAULT_PLACE_X_REL``/``Y_REL`` or
  ``SAFE_INTERMEDIATE_POSE`` — real-hardware place motions still run on
  Gazebo-tuned numbers.
* The pick and place rack slot pitch disagree: 20.17mm in
  ``_REAL_PROFILE["LOCATION_PROFILES"]`` vs 22.23mm in
  ``_REAL_PROFILE["PICK_RACK_PROFILE"]``, on what is physically the same
  rack. See the ``UNRESOLVED`` note on ``LOCATION_PROFILES`` below.
* ``HW_VERIFY_TOL_DEG`` / ``HW_VERIFY_TIMEOUT_S`` / ``HW_GRASP_SLIP_TOL_MM``
  are still the original guessed values — never measured against real
  encoder jitter or gripper-slip behaviour.
"""

import math

from backend.functions.env_utils import get_bool_env, get_int_env

DRIVE_HARDWARE = get_bool_env("DRIVE_HARDWARE")

# Robot base pose in the Gazebo world (worldCobotta.sdf, Cobotta include pose)
# — physical constant, same in both profiles. Source of truth for the
# TABLE_TOP_Z_ABS / PICK_Z_REF_OFFSET invariant asserted below.
ROBOT_BASE_Z: float = 1.05

# Geometry of the shared tube rack (ros2_ws/Cobotta/locations/tube_rack/model.sdf
# — one model serves both the pick and place ends). Physical properties of the
# rack itself, so not profile-dependent. testing/test_twin_parity.py asserts
# both against the SDF, which is the actual source of truth for the mesh.
RACK_RIM_H: float = 0.035          # wall height above the table
RACK_SLOT_INNER_W: float = 0.02063  # slot interior; wider objects can't go in one

# Gazebo-tuned baseline — also the template the real profile is built from.
_SIM_PROFILE = {
    "URDF_GAZEBO_Z_OFFSET": 0.085,
    # TABLE_TOP_Z_ABS is Gazebo-WORLD-absolute z (consumed directly by spawn/snap
    # RPCs). PICK_Z_REF_OFFSET is ROBOT-RELATIVE z (fed to IK; matches a real
    # CurPos.Z reading at table contact). They must satisfy:
    #   PICK_Z_REF_OFFSET == TABLE_TOP_Z_ABS - ROBOT_BASE_Z
    # The real-cell table-contact measurement (CurPos.Z=-36.61mm) belongs in
    # PICK_Z_REF_OFFSET, not TABLE_TOP_Z_ABS — a robot-frame measurement is
    # not a world-frame quantity. The assert below catches this class of
    # mistake.
    "TABLE_TOP_Z_ABS": 1.0134,
    "PICK_Z_REF_OFFSET": -0.0366,
    "DEFAULT_PICK_X_REL": -0.05,
    "DEFAULT_PICK_Y_REL": -0.28,
    "DEFAULT_PLACE_X_REL": 0.20,
    "DEFAULT_PLACE_Y_REL": -0.21,
    "SAFE_INTERMEDIATE_POSE": [51.56, 20.05, 87.08, 0.0, 48.70, 0.0],
    "SCAN_POSE": [0.0, 30.0, 70.0, 0.0, 80.0, 0.0],
    # Both rack profiles below describe ONE physical object — the 4-slot rack in
    # ros2_ws/Cobotta/locations/tube_rack/model.sdf, used at both ends of the
    # cell. Pitch 22.23mm, slot 0 at the profile's own reference point, taken
    # from the real cell's measured PICK_RACK_PROFILE offsets so the twin
    # reproduces the rack that actually exists rather than a placeholder. They
    # differ only in axis, which is a consequence of how the model is oriented:
    # the pick rack is included unrotated (slots along X), the place rack is
    # spawned with yaw +90° by _h_place (slots along Y).
    "LOCATION_PROFILES": {
        # grasp_yaw (rad): gripper rotation for rack pick/place, in case fingers
        # need to turn 90° (math.pi/2) to clear adjacent tubes. 0.0 = untested
        # default — tune on real hardware if fingers hit a neighboring slot.
        "tube_rack": {
            "slot_xy_offsets": [
                (0.0, 0.0),
                (0.0, 0.02223),
                (0.0, 0.04447),
                (0.0, 0.06670),
            ],
            "grasp_yaw": 0.0,
        },
    },
    # Pick has no "location" block (it's always the rack) so it can't share
    # LOCATION_PROFILES by name — and on the real cell its offsets are NOT the
    # same as the place rack's (see _REAL_PROFILE override), so it needs its
    # own profile rather than reusing "tube_rack".
    "PICK_RACK_PROFILE": {
        "slot_xy_offsets": [
            (0.0, 0.0),
            (0.02223, -0.00040),
            (0.04447, -0.00080),
            (0.06670, -0.00120),
        ],
        "grasp_yaw": 0.0,
    },
    "CONDITION_TIMEOUT_S": 30,
    "SPAWN_SETTLE_THRESHOLD_M": 0.001,
    "PICK_Z_FINE_TUNE": 0.0,
    # Twin-coherence guards (real hardware only). NOT YET REAL-HARDWARE-TUNED:
    # these are guessed values — nothing has measured real encoder jitter or
    # real gripper-slip behaviour against them, and _REAL_PROFILE never
    # overrides any of the three. Tighten/loosen here once real data exists.
    "HW_VERIFY_TOL_DEG": 2.0,
    "HW_VERIFY_TIMEOUT_S": 3.0,
    "HW_GRASP_SLIP_TOL_MM": 1.5,
}

# Real-cell profile — calibrate with the teach pendant before using DRIVE_HARDWARE=1.
# Override only the keys that differ from the sim baseline; everything else inherits.
# The table-contact measurement (CurPos.Z=-36.61mm) is folded into the sim
# baseline's PICK_Z_REF_OFFSET above (world SDF table pose moved to match) —
# real and sim Z geometry coincide, so no override here yet. Add one only for
# a value that genuinely differs on the physical cell (e.g. after the cell
# is moved).
_REAL_PROFILE = {
    **_SIM_PROFILE,
    # Measured with testing/calibrate_rack.py `read`, jogged by hand to the
    # real pick point so the object stays in frame at the current SCAN_POSE.
    # All rack-slot offsets (PICK_RACK_PROFILE, LOCATION_PROFILES) are
    # relative to this point, so moving it shifts every slot together —
    # re-verify slot 3 (the only independently-measured non-zero slot) if
    # picks still miss.
    "DEFAULT_PICK_X_REL": -0.0430,
    "DEFAULT_PICK_Y_REL": -0.2985,
    # Real-cell only: the wrist-mounted Canon camera looks straight down at
    # the sim SCAN_POSE's J5=80 (near-vertical wrist pitch), so YOLO only
    # ever sees the top face of an object (e.g. a tube reads as a circle,
    # not a cylinder). Lowering J5 tilts the camera toward an oblique view
    # (top+side) without moving the arm's XY position, for better class/cap-
    # colour recognition. No effect in sim — the sim detection camera is a
    # fixed world model (worldCobotta.sdf), not robot-mounted, so a wrist
    # angle change there wouldn't change what it sees anyway.
    #
    # Current recognition status at this pose, verified with
    # testing/scan_recognition_check.py: blue tube detected (bottle
    # conf=0.37, color=blue — clears the default 0.35 threshold), red tube
    # detected but marginal (conf=0.20, no cap-colour match, does NOT clear
    # threshold), green tube missed entirely. Distance to the rack is the
    # dominant lever, more than tilt — framing/centering, maybe exposure,
    # still need work before all rack slots are reliably recognized; not a
    # validated final pose yet.
    #
    # J2/J3 must stay inside JOINT_LIMITS_DEG (cobotta_utils.py) — the teach
    # pendant allows a physical jog past the limit, but /api/move-target's
    # Flask layer silently CLAMPS out-of-range joints instead of rejecting
    # them, so an out-of-limit pose quietly stops ~2.5-3° short of commanded
    # and can trip the twin-divergence safety check (tol 2.0°) right after
    # the scan move. The pose below carries a 2° margin inside the limits but
    # has not been re-verified against the camera since that correction
    # (framing may have shifted slightly) — re-run
    # testing/scan_recognition_check.py before trusting recognition again.
    "SCAN_POSE": [0.90, -58.0, 138.0, -1.45, 57.77, -1.97],
    # Pick and place offsets are NOT the same rack orientation/approach —
    # pick is dominantly X (rack lies ~left-to-right in front of the arm),
    # place is dominantly Y — hence PICK_RACK_PROFILE and LOCATION_PROFILES
    # stay two separate dicts here, same as in _SIM_PROFILE above.
    #
    # Measured with testing/calibrate_rack.py `read`: slot 0 is the fixed
    # single-object point (exact by definition), slot 3 was jogged by hand
    # and read back. Slots 1/2 are NOT independently measured — linearly
    # interpolated between 0 and 3 (evenly-spaced rack holes assumed;
    # re-measure 1/2 directly with `read` if a real pick misses).
    "PICK_RACK_PROFILE": {
        "slot_xy_offsets": [
            (0.0, 0.0),
            (0.02223, -0.00040),
            (0.04447, -0.00080),
            (0.06670, -0.00120),
        ],
        # Confirmed on hardware: fingers don't clear adjacent tubes at
        # yaw=0, a 90° rotation is required to pick from the rack. NOT yet
        # confirmed for place (verify separately before reusing this value
        # there).
        "grasp_yaw": math.pi / 2,
    },
    "LOCATION_PROFILES": {
        # UNRESOLVED: the pick and place racks are the SAME physical object,
        # so these offsets should have
        # the same pitch as PICK_RACK_PROFILE above — but they don't: 20.17mm
        # here vs 22.23mm there, a 6mm disagreement by slot 3. Both were derived
        # the same way (slot 0 and slot 3 measured, 1/2 interpolated), so at
        # least one of the two slot-3 readings is off. Left exactly as measured
        # rather than averaged: an invented number on the physical cell is worse
        # than a known-suspect measured one. Re-measure slot 3 at BOTH ends with
        # testing/calibrate_rack.py `read` at the next hardware session and make
        # the two pitches agree. The sim profile uses 22.23mm for both.
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

# Extra release height per location, in metres, added to whatever
# resolve_place_z() computes from the model's own geometry. Zero for anything
# not listed.
#
# This is a per-location knob on purpose. The clearance terms inside
# resolve_place_z (+0.003 into a container, +0.02 above a rim) are shared by
# every location, so raising one of those to help the cup would also drop tubes
# into the tube rack from 2 cm up — a rack slot has 1.3 mm of side clearance and
# wants the release as low as it can get, which is the opposite requirement.
#
# cup: measured on the physical cell 2026-09-01. The computed descent puts the
# tube's base essentially on the cup floor, and the operator asked for 2 cm of
# air under it — a transparent cup flexes and the tube can catch its wall on the
# way down.
PLACE_Z_OFFSETS: dict[str, float] = {
    "cup": 0.020,
}


# Guard against a profile drifting out of sync with the baseline key set.
assert _SIM_PROFILE.keys() == _REAL_PROFILE.keys(), (
    "calibration profiles must expose the same keys: "
    f"{_SIM_PROFILE.keys() ^ _REAL_PROFILE.keys()}"
)

# Guard against a robot-frame Z measurement written into the world-frame key
# (or vice versa) — the same class of mistake CLAUDE.md warns about when
# calibrating a real cell. TABLE_TOP_Z_ABS is
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
# Overridable per-session via HUMAN_STEP_TIMEOUT_S. Neither profile overrides
# it, so the env var is the only way to change it — needed for user-study
# sessions, where a human step dimensioned for the default would fail on
# calibration rather than on the confirmation channel under test. This is the
# single source of truth: the value sent to the frontend countdown must come
# from here too (simulate.py's human-step-start payload), or the operator sees
# a countdown that disagrees with the deadline actually being enforced.
CONDITION_TIMEOUT_S: int = get_int_env(
    "HUMAN_STEP_TIMEOUT_S", ACTIVE["CONDITION_TIMEOUT_S"]
)
SPAWN_SETTLE_THRESHOLD_M: float = ACTIVE["SPAWN_SETTLE_THRESHOLD_M"]
PICK_Z_FINE_TUNE: float = ACTIVE["PICK_Z_FINE_TUNE"]
HW_VERIFY_TOL_DEG: float = ACTIVE["HW_VERIFY_TOL_DEG"]
HW_VERIFY_TIMEOUT_S: float = ACTIVE["HW_VERIFY_TIMEOUT_S"]
HW_GRASP_SLIP_TOL_MM: float = ACTIVE["HW_GRASP_SLIP_TOL_MM"]
