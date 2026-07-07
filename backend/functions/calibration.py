"""Motion calibration profiles for the digital twin and the real Cobotta cell.

Two profiles exist:

* ``_SIM_PROFILE`` — Gazebo-tuned values. The source of truth for simulation;
  do not change these unless the simulation world geometry changes.
* ``_REAL_PROFILE`` — starts as a copy of the sim profile and overrides only the
  keys that differ on the physical cell. Calibrate with the teach pendant before
  enabling ``DRIVE_HARDWARE=1``; see docs/cobotta-calibration.md.

``ACTIVE`` selects between them based on the DRIVE_HARDWARE environment flag.
The individual module-level constants below are what simulate.py imports.

Units:
* ``*_Z_OFFSET`` / ``*_Z_*`` / ``*_REL`` distances are in metres.
* ``*_POSE`` lists are six joint angles in degrees (J1..J6).
* ``slot_y_offsets`` are per-slot Y displacements in metres.
"""

from backend.functions.env_utils import get_bool_env

DRIVE_HARDWARE = get_bool_env("DRIVE_HARDWARE")

# Gazebo-tuned baseline — also the template the real profile is built from.
_SIM_PROFILE = {
    "URDF_GAZEBO_Z_OFFSET": 0.085,
    "TABLE_TOP_Z_ABS": 1.04,
    "PICK_Z_REF_OFFSET": -0.01,
    "DEFAULT_PICK_X_REL": -0.05,
    "DEFAULT_PICK_Y_REL": -0.28,
    "DEFAULT_PLACE_X_REL": 0.20,
    "DEFAULT_PLACE_Y_REL": -0.21,
    "SAFE_INTERMEDIATE_POSE": [51.56, 20.05, 87.08, 0.0, 48.70, 0.0],
    "SCAN_POSE": [0.0, 30.0, 70.0, 0.0, 80.0, 0.0],
    "LOCATION_PROFILES": {
        "tube_rack": {"slot_y_offsets": [0.0, 0.027, -0.027]},
    },
    "CONDITION_TIMEOUT_S": 30,
    "SPAWN_SETTLE_THRESHOLD_M": 0.001,
    "PICK_Z_FINE_TUNE": 0.0,
    # Twin-coherence guards (real hardware only; see docs/cobotta-calibration.md).
    "HW_VERIFY_TOL_DEG": 2.0,
    "HW_VERIFY_TIMEOUT_S": 3.0,
    "HW_GRASP_SLIP_TOL_MM": 1.5,
}

# Real-cell profile — calibrate with the teach pendant before using DRIVE_HARDWARE=1.
# Override only the keys that differ from the sim baseline; everything else inherits.
# See docs/cobotta-calibration.md for the measurement procedure.
_REAL_PROFILE = {
    **_SIM_PROFILE,
    # e.g. "TABLE_TOP_Z_ABS": <measured value>,
}

# Guard against a profile drifting out of sync with the baseline key set.
assert _SIM_PROFILE.keys() == _REAL_PROFILE.keys(), (
    "calibration profiles must expose the same keys: "
    f"{_SIM_PROFILE.keys() ^ _REAL_PROFILE.keys()}"
)

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
CONDITION_TIMEOUT_S: int = ACTIVE["CONDITION_TIMEOUT_S"]
SPAWN_SETTLE_THRESHOLD_M: float = ACTIVE["SPAWN_SETTLE_THRESHOLD_M"]
PICK_Z_FINE_TUNE: float = ACTIVE["PICK_Z_FINE_TUNE"]
HW_VERIFY_TOL_DEG: float = ACTIVE["HW_VERIFY_TOL_DEG"]
HW_VERIFY_TIMEOUT_S: float = ACTIVE["HW_VERIFY_TIMEOUT_S"]
HW_GRASP_SLIP_TOL_MM: float = ACTIVE["HW_GRASP_SLIP_TOL_MM"]
