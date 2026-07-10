from backend.functions.task import _resolve_runtime_workspace
from backend.block_types import (
    LogicItems,
    StepsItems,
    EventsItems,
    MacroItems,
)
import subprocess
import logging
from dataclasses import dataclass, field
from typing import List
from django.http import HttpResponse, HttpRequest
from backend.utils.response import (
    HttpMethod,
    invalid_request_method,
    error_response,
    success_response,
    unauthorized_request,
)
from backend.models import Task, Object, Location, Action
from backend.functions.vision_mapping import parse_object_query
from json import loads
from django.db.models import Q
import time
import platform
import os
import math
import xml.etree.ElementTree as ET
import ikpy.chain
import numpy as np
import threading
import requests.exceptions
from backend.functions.env_utils import get_bool_env
from backend.functions.flask_ros_client import FlaskRosClient
from backend.functions.calibration import (
    URDF_GAZEBO_Z_OFFSET,
    TABLE_TOP_Z_ABS,
    PICK_Z_REF_OFFSET,
    DEFAULT_PICK_X_REL,
    DEFAULT_PICK_Y_REL,
    DEFAULT_PLACE_X_REL,
    DEFAULT_PLACE_Y_REL,
    SAFE_INTERMEDIATE_POSE,
    SCAN_POSE,
    LOCATION_PROFILES,
    CONDITION_TIMEOUT_S,
    PICK_Z_FINE_TUNE,
    HW_VERIFY_TOL_DEG,
    HW_VERIFY_TIMEOUT_S,
    HW_GRASP_SLIP_TOL_MM,
)

logger = logging.getLogger(__name__)

FLASK_BRIDGE_URL = os.getenv("FLASK_BRIDGE_URL", "http://localhost:5000").rstrip("/")

# Shared client for all Flask-ROS bridge calls (centralizes URL + timeouts).
_bridge = FlaskRosClient(FLASK_BRIDGE_URL)

# Server-side enablement: cobotta_node must be running with enable_hardware:=true
# for this server to be ALLOWED to drive real hardware at all. Does not, by
# itself, move the arm — see _HW_DRIVE_REQUESTED below.
# Default off — sim stack unchanged when unset.
DRIVE_HARDWARE = get_bool_env("DRIVE_HARDWARE")
MAX_LOOP_ITERATIONS = int(os.getenv("MAX_LOOP_ITERATIONS", "10"))

# Per-request switch, set by simulate_task() from the "driveHardware" body key.
# NOTE: single-process runserver only (same constraint as SIMULATION_STOP_EVENT
# above) — a multi-process WSGI deployment would need shared state. Combined
# with the _SIM_RUN_LOCK busy-guard in simulate_task(), only one run touches
# this flag at a time, so the single global is safe under runserver's default
# threading.
_HW_DRIVE_REQUESTED: bool = False


def _hw_drive_active() -> bool:
    """True only when the server is armed (DRIVE_HARDWARE) AND the current
    request explicitly asked to drive hardware (driveHardware: true in the
    /api/task/simulate/ body). Neither alone is enough — a "Simulation" run
    must never move the real arm just because the server happens to be armed
    for a "Real robot" session elsewhere."""
    return DRIVE_HARDWARE and _HW_DRIVE_REQUESTED


def convert_hand_gazebo_cobotta(gazebo_hand_value):
    """Convert a Gazebo gripper joint value (metres, per finger) to the Cobotta
    hand aperture scale (~0-30). The +0.015 m re-centres the Gazebo zero and the
    ×2000 scales metres to the controller's native units."""
    return (gazebo_hand_value + 0.015) * 2000


CURRENT_JOINTS = [0.0, 0.0, 90.0, 0.0, 0.0, 0.0]
CURRENT_HAND = 30.0  # Open gripper
STATE_LOCK = threading.Lock()

# Gripper aperture (mm) reported by the real arm after its last move-target call,
# piggybacked on the MoveTarget response message. None when no hardware or the
# node's HandCurPos read failed — _verify_hw_grasp treats that as "no data".
_LAST_HW_HAND_MM: float | None = None

# Set by stop_simulation view; checked by the parser and sleep helpers to abort early.
# NOTE: works only with single-process Django (runserver); a multi-process WSGI
# deployment would need shared state (e.g. Redis-backed flag).
SIMULATION_STOP_EVENT = threading.Event()

# Set by _abort_task on the first hard failure (hardware unreachable, twin
# divergence, missed grasp, vision timeout). simulate_task() turns this into an
# error_response instead of the usual success_response once the parser returns.
_TASK_ABORT_REASON: str | None = None

# Busy-guard: only one simulate_task() run at a time. Without this, Django
# runserver's default threading lets two concurrent requests race on the
# _HW_DRIVE_REQUESTED flag above — a "Simulation" request could read a
# "Real robot" request's True and move the physical arm. Serializing runs
# makes the per-request flag safe with a single global (only one request
# ever holds it) and, as a side effect, stops two requests from ever
# commanding the same physical arm at once.
_SIM_RUN_LOCK = threading.Lock()

# Tracks Gazebo model names spawned in the current simulation run.
# Used by find_object bypass: if object is in world, skip vision polling.
# Cleared on reset_simulation_world(), delete_spawned_object_and_place(), and STOP.
_spawned_in_world: set = set()

# Registry of persisted placed-object entity names (e.g. "placed_3"), spawned
# by _persist_placed_object so a placed item survives the next pick's cleanup
# of the reusable "object" entity. _placed_seq is monotonic and never reset
# mid-run, so a failed sweep can't cause a name collision on next spawn.
_placed_in_world: list = []
_placed_seq: int = 0


def _abort_task(reason: str):
    """Hard-abort the running task: stop the parser loop, stop Gazebo AND the real
    arm (so the twin can't keep moving while the reason for aborting is exactly
    that the two diverged), and tell the frontend why.

    Idempotent: only the first reason is kept if called more than once.
    """
    global _TASK_ABORT_REASON
    if _TASK_ABORT_REASON is None:
        _TASK_ABORT_REASON = reason
    SIMULATION_STOP_EVENT.set()
    try:
        _bridge.stop()
    except Exception as e:
        print(f"[ABORT] bridge stop failed: {e}")
    try:
        _bridge.notify("/api/notify", {"description": f"TASK ABORTED: {reason}"})
    except Exception:
        pass
    print(f"[ABORT] {reason}")


def _interruptible_sleep(seconds):
    """Sleep in 0.1 s slices, returning early if SIMULATION_STOP_EVENT is set."""
    end = time.time() + seconds
    while time.time() < end:
        if SIMULATION_STOP_EVENT.is_set():
            return
        time.sleep(min(0.1, end - time.time()))


def get_current_state():
    with STATE_LOCK:
        return list(CURRENT_JOINTS), CURRENT_HAND


def set_current_state(joints, hand):
    global CURRENT_JOINTS, CURRENT_HAND
    with STATE_LOCK:
        CURRENT_JOINTS = list(joints)
        CURRENT_HAND = hand


def sync_current_state_from_ros():
    """Sync joint state from the Flask bridge. Returns True on success, False if state is stale.

    When hardware is active for this request, seed the joints from the physical
    arm's encoders (/api/actual-joints-real) so IK plans from where the real
    robot actually is — the closed loop. Falls back to the Gazebo twin if the
    real feed is empty.
    """
    if _hw_drive_active():
        try:
            real = _bridge.get_actual_joints_real()
            if len(real) >= 6:
                _, hand = get_current_state()  # no real hand readback — keep current
                set_current_state(real[:6], hand)
                return True
            print("[SIMULATOR] real encoder feed empty — falling back to Gazebo state")
        except Exception as e:
            print(f"[SIMULATOR] Error reading real joint state: {e} — falling back to Gazebo")
    try:
        pos = _bridge.get_actual_joints()
        if len(pos) >= 7:
            joints = pos[:6]
            hand_gazebo = pos[6]
            hand_cobotta = max(0.0, min(30.0, convert_hand_gazebo_cobotta(hand_gazebo)))
            set_current_state(joints, hand_cobotta)
            return True
    except Exception as e:
        print(f"[SIMULATOR] Error syncing state from ROS: {e}")
    print("[SIMULATOR] WARNING: could not sync joint state from ROS — IK seed may be stale")
    return False


# Dynamically calculate the base project directory (DTblocklyGPT root)
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

URDF_PATH = os.path.join(BASE_DIR, "ros2_ws", "Cobotta", "urdf", "cobotta_ik.urdf")

if os.path.exists(URDF_PATH):
    try:
        full_chain = ikpy.chain.Chain.from_urdf_file(URDF_PATH, base_elements=["base_link"])
        # Keep only links up to joint_hand to use hand center as TCP (no X/Y offset)
        links = []
        for link in full_chain.links:
            links.append(link)
            if link.name == "joint_hand":
                break
        joint_names = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6']
        active_mask = [link.name in joint_names for link in links]
        COBOTTA_CHAIN = ikpy.chain.Chain(name='cobotta', links=links, active_links_mask=active_mask)

        print("[SIMULATOR] COBOTTA_CHAIN initialized successfully.")
        print("[SIMULATOR] Link map:")
        for i, link in enumerate(COBOTTA_CHAIN.links):
            print(f"  {i}: {link.name} (bounds={link.bounds})")
    except Exception as e:
        print(f"Error initializing ikpy chain: {e}")
        COBOTTA_CHAIN = None
else:
    COBOTTA_CHAIN = None


def debug_fk(q_deg, label="FK"):
    if COBOTTA_CHAIN is None:
        return
    joints_full = [0.0] * len(COBOTTA_CHAIN.links)
    name_to_idx = {'joint1': 0, 'joint2': 1, 'joint3': 2, 'joint4': 3, 'joint5': 4, 'joint6': 5}
    for i, link in enumerate(COBOTTA_CHAIN.links):
        if link.name in name_to_idx:
            joints_full[i] = math.radians(q_deg[name_to_idx[link.name]])
    T = COBOTTA_CHAIN.forward_kinematics(joints_full)
    pos = T[:3, 3]
    # In Gazebo: X = Y_urdf, Y = -X_urdf, Z = Z_urdf - 0.085
    print(f"[{label}] TCP (URDF) x={pos[0]:.3f}, y={pos[1]:.3f}, z={pos[2]:.3f} | (Gazebo) x={pos[1]:.3f}, y={-pos[0]:.3f}, z={pos[2] - URDF_GAZEBO_Z_OFFSET:.3f}")


def get_sdf_dimensions(sdf_name: str, folder: str = "objects"):
    try:
        # Sanitize input to prevent directory traversal
        safe_name = sdf_name.replace(" ", "_").lower()
        sdf_path = os.path.join(BASE_DIR, "ros2_ws", "Cobotta", folder, safe_name, "model.sdf")
        if not os.path.exists(sdf_path):
            return None, None, 0.0

        tree = ET.parse(sdf_path)
        root = tree.getroot()
        collisions = root.findall(".//collision")
        if not collisions:
            return None, None, 0.0

        min_z = float('inf')
        max_z = float('-inf')
        max_width = 0.0

        for col in collisions:
            pose_elem = col.find("pose")
            pose_z = 0.0
            if pose_elem is not None and pose_elem.text:
                parts = pose_elem.text.strip().split()
                if len(parts) >= 3:
                    pose_z = float(parts[2])

            geom = col.find("geometry")
            if geom is not None:
                box = geom.find("box")
                if box is not None and box.find("size") is not None:
                    size_str = box.find("size").text.strip().split()
                    size_x = float(size_str[0])
                    size_y = float(size_str[1])
                    size_z = float(size_str[2])

                    c_min_z = pose_z - size_z / 2.0
                    c_max_z = pose_z + size_z / 2.0
                    min_z = min(min_z, c_min_z)
                    max_z = max(max_z, c_max_z)
                    max_width = max(max_width, min(size_x, size_y))

                cylinder = geom.find("cylinder")
                if cylinder is not None:
                    radius_elem = cylinder.find("radius")
                    length_elem = cylinder.find("length")
                    if radius_elem is not None and length_elem is not None:
                        r = float(radius_elem.text.strip())
                        length_val = float(length_elem.text.strip())

                        c_min_z = pose_z - length_val / 2.0
                        c_max_z = pose_z + length_val / 2.0
                        min_z = min(min_z, c_min_z)
                        max_z = max(max_z, c_max_z)
                        max_width = max(max_width, 2.0 * r)

        if min_z != float('inf') and max_z != float('-inf'):
            return max_z - min_z, max_width, min_z
    except Exception as e:
        print(f"[SIMULATOR] Error parsing SDF {sdf_name}: {e}")
    return None, None, 0.0


IK_POS_TOL = 0.004   # 4 mm max FK residual
IK_AXIS_TOL_DEG = 6.0  # 6° max Z-axis misalignment


def fk_position_error(angles_deg, target_urdf):
    """Return (pos_err_m, axis_err_deg) for an IK solution vs the desired target."""
    if COBOTTA_CHAIN is None:
        return float('inf'), float('inf')
    joints_full = [0.0] * len(COBOTTA_CHAIN.links)
    joint_names = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6']
    name_to_rad = {n: math.radians(angles_deg[i]) for i, n in enumerate(joint_names)}
    for i, link in enumerate(COBOTTA_CHAIN.links):
        if link.name in name_to_rad:
            joints_full[i] = name_to_rad[link.name]
    T = COBOTTA_CHAIN.forward_kinematics(joints_full)
    pos_err = float(np.linalg.norm(T[:3, 3] - np.array(target_urdf)))
    # Angle between FK Z-column and desired downward direction [0,0,-1]
    z_col = T[:3, 2]
    dot = float(np.clip(np.dot(z_col, [0.0, 0.0, -1.0]), -1.0, 1.0))
    axis_err_deg = math.degrees(math.acos(dot))
    return pos_err, axis_err_deg


def _ik_with_verification(target_urdf, target_orientation, initial_position, label=""):
    """Run IK once, verify with FK, return angles_deg or None."""
    try:
        ik_sol = COBOTTA_CHAIN.inverse_kinematics(
            target_urdf,
            target_orientation=target_orientation,
            orientation_mode="Z",
            initial_position=initial_position,
        )
        angles_deg = []
        joint_names = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6']
        for name in joint_names:
            for i, link in enumerate(COBOTTA_CHAIN.links):
                if link.name == name:
                    angles_deg.append(math.degrees(ik_sol[i]))
                    break
        pos_err, axis_err = fk_position_error(angles_deg, target_urdf)
        if pos_err > IK_POS_TOL or axis_err > IK_AXIS_TOL_DEG:
            print(f"[IK{label}] FK residual pos={pos_err * 1000:.1f}mm axis={axis_err:.1f}° — rejected")
            return None, pos_err
        return angles_deg, pos_err
    except Exception as e:
        print(f"[IK{label}] solver exception: {e}")
        return None, float('inf')


def _heuristic_seed_j235(z_rel: float) -> tuple:
    """(j2, j3, j5) degrees for a top-down TCP at z_rel — linear interpolation
    between two anchor postures instead of one fixed posture for every height.

    A single fixed seed (45/70/45) converges reliably near its own height but
    drifts into rejected local minima as the target height moves away from it
    (ikpy's IK is a local solve from the seed) — this is why the gantry-transit
    height band failed non-monotonically (see docs/cobotta-physical-session-
    2026-07-07.md §7).

    Anchors are empirically verified (offline grid search over j2/j3/j5, both
    the default pick and place XY sites), not hand-picked from first
    principles: 0.02 keeps the original low-height posture; 0.23 matches
    CARRY_Z_MAX exactly, in the middle of a wide basin of working postures at
    that height — z_rel is never extrapolated past it because simulate_ros_
    place clamps z_carry into [.., CARRY_Z_MAX]. Above ~0.24 no single seed
    (of many tried, including outside this basin) reliably converges for this
    arm geometry regardless of posture — that's a real solver/geometry limit,
    not a seed-tuning gap, which is why the transit height is clamped rather
    than chased with a "better" anchor. See testing/test_ik_regression.py
    test_transit_z_sweep for the documented reliable band.
    """
    zs = (0.02, 0.23)
    j2s = (45.0, -20.0)
    j3s = (70.0, 40.0)
    j5s = (45.0, 10.0)
    return (
        float(np.interp(z_rel, zs, j2s)),
        float(np.interp(z_rel, zs, j3s)),
        float(np.interp(z_rel, zs, j5s)),
    )


def solve_gazebo_ik(x_rel, y_rel, z_rel, grasp_yaw=0.0, seed_joints=None):
    if COBOTTA_CHAIN is None:
        print("[SIMULATOR] Error: ikpy chain not initialized")
        return None

    target_urdf = np.array([-y_rel, x_rel, z_rel + URDF_GAZEBO_Z_OFFSET])
    target_orientation = [0.0, 0.0, -1.0]

    def _make_seed(seed):
        pos = [0.0] * len(COBOTTA_CHAIN.links)
        if seed is not None:
            seed_map = {
                'joint1': math.radians(seed[0]),
                'joint2': math.radians(seed[1]),
                'joint3': math.radians(seed[2]),
                'joint4': math.radians(seed[3]),
                'joint5': math.radians(seed[4]),
                'joint6': math.radians(seed[5]),
            }
            for i, link in enumerate(COBOTTA_CHAIN.links):
                if link.name in seed_map:
                    pos[i] = seed_map[link.name]
        else:
            target_j1 = math.atan2(x_rel, -y_rel)
            j2_deg, j3_deg, j5_deg = _heuristic_seed_j235(z_rel)
            for i, link in enumerate(COBOTTA_CHAIN.links):
                if link.name == 'joint1':
                    pos[i] = target_j1
                elif link.name == 'joint2':
                    pos[i] = math.radians(j2_deg)
                elif link.name == 'joint3':
                    pos[i] = math.radians(j3_deg)
                elif link.name == 'joint4':
                    pos[i] = 0.0
                elif link.name == 'joint5':
                    pos[i] = math.radians(j5_deg)
                elif link.name == 'joint6':
                    pos[i] = grasp_yaw
        return pos

    # Attempt 1: provided seed (or heuristic)
    angles, err = _ik_with_verification(target_urdf, target_orientation, _make_seed(seed_joints))
    if angles:
        return angles

    # Attempt 2: heuristic seed (ignore provided seed)
    if seed_joints is not None:
        angles, err = _ik_with_verification(target_urdf, target_orientation, _make_seed(None), " retry-heuristic")
        if angles:
            return angles

    # Attempt 3: perturbed heuristic seed (joint2 +10°, joint3 -10°)
    perturbed = _make_seed(None)
    for i, link in enumerate(COBOTTA_CHAIN.links):
        if link.name == 'joint2':
            perturbed[i] += math.radians(10.0)
        elif link.name == 'joint3':
            perturbed[i] -= math.radians(10.0)
    angles, err = _ik_with_verification(target_urdf, target_orientation, perturbed, " retry-perturb")
    if angles:
        return angles

    print(f"[SIMULATOR] IK failed all attempts for x={x_rel:.3f} y={y_rel:.3f} z={z_rel:.3f} (last pos_err={err * 1000:.1f}mm)")
    return None


def resolve_object_metrics(obj, sdf_name):
    # Try reading database height & width
    db_height = getattr(obj, "height", 0.0) or 0.0
    db_width = getattr(obj, "obj_width", 0.0) or 0.0

    height_m = None
    width_m = None

    if db_height != 0.0:
        # Check if negative/real robot raw TCP coordinate (table at -32.5 mm)
        if db_height < 0.0 or db_height > 1.0:
            height_m = 2.0 * (db_height + 32.5) / 1000.0
        elif db_height > 0.0:
            if db_height > 0.5:
                height_m = db_height / 1000.0
            else:
                height_m = db_height

    if db_width > 0.0:
        if db_width > 0.5:
            width_m = db_width / 1000.0
        else:
            width_m = db_width

    # Try parsing SDF model file
    sdf_height, sdf_width, _ = get_sdf_dimensions(sdf_name)

    # Prioritize SDF dimensions as they are the true physical dimensions in Gazebo
    if sdf_height is not None and sdf_height > 0.001:
        height_m = sdf_height
    elif height_m is None or height_m <= 0.001:
        height_m = 0.015  # default pill height (15mm)

    if sdf_width is not None and sdf_width > 0.001:
        width_m = sdf_width
    elif width_m is None or width_m <= 0.001 or width_m > 0.03:
        width_m = 0.015  # default width

    return height_m, width_m


# ──────────────────────────────────────────────────────────────────────────────
# PHASE 2 — Generic TOP-grasp planning from collision geometry
#
# normalize_object_for_grasp(sdf) -> ObjectModel : object normalization
# plan_pick_for_object(model, ...) -> PickPlan   : grasp synthesis
# (execution stays the Phase-1 deterministic snap+weld in simulate_ros_pick).
#
# Scope: custom-object support for TOP-graspable shapes only. Side grasps,
# concave/multi-collision shapes and richer grasp families are Phase 3.
# ──────────────────────────────────────────────────────────────────────────────


@dataclass
class ObjectModel:
    """Normalized graspable description derived from an object's COLLISION
    geometry (never the visual). For complex meshes it falls back to a
    bbox/cylinder proxy — that mesh→proxy boundary is the supported frontier."""
    sdf_name: str
    collision_type: str            # 'cylinder' | 'box' | 'mesh_proxy' | 'unknown'
    size_x: float                  # AABB extents (m), model frame
    size_y: float
    size_z: float
    min_z: float                   # bottom offset from origin (m)
    center_x: float                # AABB centre X/Y (m) — top-grasp alignment
    center_y: float
    graspable_width: float         # finger-closing width at grasp height (m)
    grasp_center_offset: float     # grasp height ABOVE the object bottom (m)
    grasp_classification: str      # 'top' | 'needs_side' | 'unsupported'
    yaw_symmetric: bool
    tool_yaw: float                # gripper yaw (rad)
    place_support_offset: float    # rest offset on a surface (= -min_z)
    attach_mode: str               # 'snap_weld' (DT) | 'physical' (real robot)
    feasible: bool
    reason: str
    source: str                    # 'heuristic' | 'meta_override'
    proxy_used: bool               # a mesh collision forced a primitive proxy


@dataclass
class PickPlan:
    """Grasp parameters for one pick, with explicit poses so the executor never
    reaches back into module globals."""
    spawn_pose: tuple              # (x_rel, y_rel) robot-relative pick target
    x_rel: float
    y_rel: float
    z_pick: float                  # robot-relative grasp height for IK
    tool_yaw: float
    hand_close: int
    grasp_center_offset: float
    feasible: bool
    reason: str
    planning_notes: dict = field(default_factory=dict)


def _load_object_meta(safe_name: str):
    """Optional Level-2 metadata sidecar: objects/<name>/object.meta.json."""
    path = os.path.join(BASE_DIR, "ros2_ws", "Cobotta", "objects", safe_name, "object.meta.json")
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            return loads(f.read())
    except Exception as e:
        print(f"[GRASP] meta parse error for '{safe_name}': {e}")
        return None


def _parse_object_collisions(safe_name: str):
    """Parse the UNION of all <collision> primitives (compose each <pose>).

    Returns dict {aabb, bands, collision_type, has_mesh} or None. `bands` is a
    list of (z_lo, z_hi, horiz_width) per primitive — used to read the graspable
    width at the grasp height. Rotation is ignored (demo collisions are
    axis-aligned). Mesh/sphere/other collisions set has_mesh and are skipped for
    sizing (proxy comes from any box/cylinder present)."""
    sdf_path = os.path.join(BASE_DIR, "ros2_ws", "Cobotta", "objects", safe_name, "model.sdf")
    if not os.path.exists(sdf_path):
        return None
    try:
        root = ET.parse(sdf_path).getroot()
    except Exception as e:
        print(f"[GRASP] SDF parse error for '{safe_name}': {e}")
        return None
    collisions = root.findall(".//collision")
    if not collisions:
        return None

    min_x = min_y = min_z = float('inf')
    max_x = max_y = max_z = float('-inf')
    bands = []
    n_box = n_cyl = 0
    has_mesh = False

    for col in collisions:
        px = py = pz = 0.0
        pose_elem = col.find("pose")
        if pose_elem is not None and pose_elem.text:
            parts = pose_elem.text.strip().split()
            if len(parts) >= 3:
                px, py, pz = float(parts[0]), float(parts[1]), float(parts[2])
        geom = col.find("geometry")
        if geom is None:
            continue
        box = geom.find("box")
        cyl = geom.find("cylinder")
        if box is not None and box.find("size") is not None:
            s = box.find("size").text.strip().split()
            sx, sy, sz = float(s[0]), float(s[1]), float(s[2])
            hx, hy, hz = sx / 2.0, sy / 2.0, sz / 2.0
            horiz_w = min(sx, sy)
            n_box += 1
        elif cyl is not None and cyl.find("radius") is not None and cyl.find("length") is not None:
            r = float(cyl.find("radius").text.strip())
            ln = float(cyl.find("length").text.strip())
            hx = hy = r
            hz = ln / 2.0
            horiz_w = 2.0 * r
            n_cyl += 1
        else:
            has_mesh = True   # mesh / sphere / unsupported primitive
            continue
        min_x, max_x = min(min_x, px - hx), max(max_x, px + hx)
        min_y, max_y = min(min_y, py - hy), max(max_y, py + hy)
        min_z, max_z = min(min_z, pz - hz), max(max_z, pz + hz)
        bands.append((pz - hz, pz + hz, horiz_w))

    if not bands:
        # only meshes/spheres: cannot size a primitive proxy
        return {"aabb": None, "bands": [], "collision_type": "mesh_proxy", "has_mesh": has_mesh}

    if n_box > 0 and n_cyl == 0:
        collision_type = "box"
    elif n_cyl > 0 and n_box == 0:
        collision_type = "cylinder"
    elif n_cyl > 0 and n_box > 0:
        collision_type = "box"   # mixed → treat as box-ish (needs yaw)
    else:
        collision_type = "unknown"

    aabb = {"min_x": min_x, "max_x": max_x, "min_y": min_y,
            "max_y": max_y, "min_z": min_z, "max_z": max_z}
    return {"aabb": aabb, "bands": bands, "collision_type": collision_type, "has_mesh": has_mesh}


def _infeasible_model(sdf_name, reason, collision_type="unknown", proxy_used=False):
    return ObjectModel(
        sdf_name=sdf_name, collision_type=collision_type,
        size_x=0.0, size_y=0.0, size_z=0.0, min_z=0.0, center_x=0.0, center_y=0.0,
        graspable_width=0.0, grasp_center_offset=0.0,
        grasp_classification="unsupported", yaw_symmetric=True, tool_yaw=0.0,
        place_support_offset=0.0, attach_mode="snap_weld",
        feasible=False, reason=reason, source="heuristic", proxy_used=proxy_used)


def normalize_object_for_grasp(sdf_name: str, obj=None) -> ObjectModel:
    """Build an ObjectModel from collision geometry, classify it, and apply an
    optional object.meta.json override. Geometry, not object name, decides the
    grasp — this subsumes the legacy flask/blue_cylinder special-case."""
    safe_name = sdf_name.replace(" ", "_").lower()
    parsed = _parse_object_collisions(safe_name)
    if parsed is None:
        return _infeasible_model(sdf_name, "no parseable collision geometry")
    if parsed["aabb"] is None:
        return _infeasible_model(
            sdf_name, "mesh/sphere collision with no primitive proxy; add object.meta.json",
            collision_type="mesh_proxy", proxy_used=True)

    aabb = parsed["aabb"]
    bands = parsed["bands"]
    collision_type = parsed["collision_type"]
    proxy_used = parsed["has_mesh"]

    size_x = aabb["max_x"] - aabb["min_x"]
    size_y = aabb["max_y"] - aabb["min_y"]
    size_z = aabb["max_z"] - aabb["min_z"]
    min_z = aabb["min_z"]
    center_x = (aabb["min_x"] + aabb["max_x"]) / 2.0
    center_y = (aabb["min_y"] + aabb["max_y"]) / 2.0

    # Grasp height above the object bottom (same intuition as the old height
    # heuristic, now from the model): upper third for tall, mid for short.
    if size_z > 0.04:
        grasp_center_offset = max(size_z / 2.0, size_z - 0.03)
    else:
        grasp_center_offset = size_z / 2.0

    # graspable_width = narrowest horizontal width among primitives that span the
    # grasp height (fingers close on the part actually at the TCP). Flask: this
    # picks the body (15 mm), not the wider cap (18 mm) — no name special-case.
    grasp_z_origin = min_z + grasp_center_offset
    covering = [w for (zlo, zhi, w) in bands if zlo - 1e-6 <= grasp_z_origin <= zhi + 1e-6]
    if covering:
        graspable_width = min(covering)
    elif size_x > 0 and size_y > 0:
        graspable_width = min(size_x, size_y)
    else:
        graspable_width = min(w for _, _, w in bands)

    yaw_symmetric = (collision_type == "cylinder")
    if yaw_symmetric:
        tool_yaw = 0.0
    else:
        # box-like: close fingers across the shorter horizontal side (convention:
        # yaw=0 closes along world-Y; rotate 90° when X is the shorter side).
        tool_yaw = 0.0 if size_y <= size_x else math.pi / 2.0
    db_yaw = getattr(obj, "grasp_yaw", 0.0) or 0.0
    if db_yaw:
        tool_yaw = db_yaw

    source = "heuristic"
    # Optional Level-2 metadata override (custom-object robustness).
    meta = _load_object_meta(safe_name)
    if meta:
        source = "meta_override"
        gco_meta = meta.get("grasp_center_offset")
        if isinstance(gco_meta, (list, tuple)) and len(gco_meta) >= 3:
            grasp_center_offset = float(gco_meta[2])
        if meta.get("max_grasp_width") is not None:
            graspable_width = float(meta["max_grasp_width"])
        psf_meta = meta.get("place_support_offset")
        if isinstance(psf_meta, (list, tuple)) and len(psf_meta) >= 3:
            min_z = -abs(float(psf_meta[2]))
        if meta.get("yaw_symmetry") is True:
            yaw_symmetric, tool_yaw = True, 0.0

    place_support_offset = -min_z

    # Classification + feasibility (only 'top' is executable in Phase 2).
    if graspable_width > MAX_GRIP_WIDTH_MM / 1000.0:
        classification, feasible = "needs_side", False
        reason = (f"graspable_width={graspable_width * 1000:.1f}mm > "
                  f"MAX={MAX_GRIP_WIDTH_MM:.0f}mm (side grasp = Phase 3, out of scope)")
    elif graspable_width <= 0.0:
        classification, feasible = "unsupported", False
        reason = "could not derive a graspable width"
    else:
        classification, feasible, reason = "top", True, "top-graspable"

    return ObjectModel(
        sdf_name=sdf_name, collision_type=collision_type,
        size_x=size_x, size_y=size_y, size_z=size_z, min_z=min_z,
        center_x=center_x, center_y=center_y,
        graspable_width=graspable_width, grasp_center_offset=grasp_center_offset,
        grasp_classification=classification, yaw_symmetric=yaw_symmetric, tool_yaw=tool_yaw,
        place_support_offset=place_support_offset, attach_mode="snap_weld",
        feasible=feasible, reason=reason, source=source, proxy_used=proxy_used)


def plan_pick_for_object(model: ObjectModel, pick_x_rel: float, pick_y_rel: float) -> PickPlan:
    """Synthesize TOP-grasp parameters from an ObjectModel. Keeps Phase-1 snap
    algebra: z_pick = PICK_Z_REF_OFFSET + grasp_center_offset (grasp point lands
    on the TCP). Infeasible models produce a PickPlan the caller must skip."""
    notes = {
        "source": model.source,
        "proxy_used": model.proxy_used,
        "top_grasp_only": True,
        "collision_type": model.collision_type,
        "classification": model.grasp_classification,
    }
    if not model.feasible:
        return PickPlan(
            spawn_pose=(pick_x_rel, pick_y_rel), x_rel=pick_x_rel, y_rel=pick_y_rel,
            z_pick=0.0, tool_yaw=0.0, hand_close=0,
            grasp_center_offset=model.grasp_center_offset,
            feasible=False, reason=model.reason, planning_notes=notes)
    z_pick = PICK_Z_REF_OFFSET + model.grasp_center_offset + PICK_Z_FINE_TUNE
    hand_close = int(min(30, max(0, round(model.graspable_width * 1000.0 - GRIPPER_GRIP_CLEARANCE_MM))))
    return PickPlan(
        spawn_pose=(pick_x_rel, pick_y_rel), x_rel=pick_x_rel, y_rel=pick_y_rel,
        z_pick=z_pick, tool_yaw=model.tool_yaw, hand_close=hand_close,
        grasp_center_offset=model.grasp_center_offset,
        feasible=True, reason=model.reason, planning_notes=notes)


def resolve_location_metrics(sdf_name: str) -> float:
    # Standard location heights in meters
    location_heights = {
        "collector": 0.06,
        "cup": 0.08,
        "pot": 0.06,
        "pulvis": 0.05,
        "plate": 0.02,
        "divider": 0.05,
        "box": 0.08,
        "pillbox": 0.04,
        "tube_rack": 0.045,
        "collection_rack": 0.06,
        "waste_bin": 0.08,
        "sample_tray": 0.02,
    }
    if not sdf_name:
        return 0.05
    safe_name = os.path.basename(sdf_name)
    sdf_height, _, _ = get_sdf_dimensions(safe_name, folder="locations")
    if sdf_height is not None and sdf_height > 0.001:
        return sdf_height
    return location_heights.get(safe_name, 0.05)


def get_location_profile(sdf_name: str):
    """
    Return (rim_height, floor_height, is_container) for a location SDF.
    rim_height  = max Z of any collision (the top of the container walls)
    floor_height = top Z of the lowest horizontal floor surface
    is_container = rim_height - floor_height >= 0.015

    For mesh-based locations (no box/cylinder primitives) returns (rim_h, None, False).
    """
    try:
        safe_name = sdf_name.replace(" ", "_").lower()
        sdf_path = os.path.join(BASE_DIR, "ros2_ws", "Cobotta", "locations", safe_name, "model.sdf")
        if not os.path.exists(sdf_path):
            return None, None, False

        tree = ET.parse(sdf_path)
        root = tree.getroot()
        collisions = root.findall(".//collision")
        if not collisions:
            return None, None, False

        rim_z = float('-inf')
        candidate_floor_z = float('inf')

        for col in collisions:
            pose_elem = col.find("pose")
            pz = 0.0
            if pose_elem is not None and pose_elem.text:
                parts = pose_elem.text.strip().split()
                if len(parts) >= 3:
                    pz = float(parts[2])

            geom = col.find("geometry")
            if geom is None:
                continue

            box = geom.find("box")
            if box is not None and box.find("size") is not None:
                sz = box.find("size").text.strip().split()
                sx, sy, sz_v = float(sz[0]), float(sz[1]), float(sz[2])
                top_z = pz + sz_v / 2.0
                rim_z = max(rim_z, top_z)
                # Candidate floor: thin horizontal surface (height << width) near origin
                if sz_v < min(sx, sy) * 0.5 and top_z < candidate_floor_z + 0.001:
                    candidate_floor_z = top_z

            cyl = geom.find("cylinder")
            if cyl is not None:
                length_val = float(cyl.find("length").text.strip())
                top_z = pz + length_val / 2.0
                rim_z = max(rim_z, top_z)

        if rim_z == float('-inf'):
            return None, None, False

        floor_height = candidate_floor_z if candidate_floor_z != float('inf') else None
        is_container = floor_height is not None and (rim_z - floor_height) >= 0.015
        return rim_z, floor_height, is_container

    except Exception as e:
        print(f"[SIMULATOR] get_location_profile error for {sdf_name}: {e}")
        return None, None, False


# All block type identifiers: shared source of truth


def launch_wsl_ros_command(command: str, expect_reply_true: bool = False) -> bool:
    """Run a shell command. Returns True on success (exit code 0), False otherwise.

    ``expect_reply_true``: for ``gz service --reptype gz.msgs.Boolean`` calls, the
    RPC prints its reply ("data: true"/"data: false") to stdout and still exits 0
    even when the service refused the request (bad SDF, name collision, entity
    not found) — exit code alone can't tell a real failure from a no-op success.
    Set this to also require "data: true" in stdout.
    """
    try:
        if platform.system() == "Windows":
            result = subprocess.run(
                ["wsl", "-d", "Ubuntu-24.04", "bash", "-c", command],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        elif platform.system() == "Linux":
            result = subprocess.run(
                ["bash", "-c", command],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        else:
            print("[SIMULATOR] Unsupported OS for launch_wsl_ros_command")
            return False
        if result.returncode != 0:
            tail = command.split("--req")[-1][:80] if "--req" in command else command[-80:]
            print(f"[SIMULATOR] Command failed (rc={result.returncode}): ...{tail}")
            stderr_out = result.stderr.decode(errors="replace").strip()
            if stderr_out:
                print(f"[SIMULATOR] stderr: {stderr_out[:200]}")
            return False
        if expect_reply_true:
            stdout_out = result.stdout.decode(errors="replace")
            if "data: true" not in stdout_out.lower():
                tail = command.split("--req")[-1][:80] if "--req" in command else command[-80:]
                print(f"[SIMULATOR] Command exited 0 but reply was not 'data: true': ...{tail}")
                print(f"[SIMULATOR] stdout: {stdout_out.strip()[:200]}")
                return False
        return True
    except Exception as e:
        print(f"[SIMULATOR] launch_wsl_ros_command exception: {e}")
        return False


def _shell_output(command: str) -> str | None:
    """Run a shell command and return its stdout regardless of exit code.

    For composite commands (subscribe-in-background & publish-then-wait), the
    outer shell can exit 0 even when the inner publish failed — the caller
    must judge success from stdout content, not the return code, which is
    why this doesn't reuse launch_wsl_ros_command's rc-gated True/False.
    """
    try:
        if platform.system() == "Windows":
            result = subprocess.run(
                ["wsl", "-d", "Ubuntu-24.04", "bash", "-c", command],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        elif platform.system() == "Linux":
            result = subprocess.run(
                ["bash", "-c", command],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        else:
            print("[SIMULATOR] Unsupported OS for _shell_output")
            return None
        return result.stdout.decode(errors="replace")
    except Exception as e:
        print(f"[SIMULATOR] _shell_output exception: {e}")
        return None


def _set_world_paused(paused: bool):
    req = "pause: true" if paused else "pause: false"
    cmd = (
        f"gz service -s /world/worldCobotta/control "
        f"--reqtype gz.msgs.WorldControl --reptype gz.msgs.Boolean "
        f"--timeout 3000 --req '{req}'"
    )
    launch_wsl_ros_command(cmd, expect_reply_true=True)


def start_ros_architecture():
    try:
        subprocess.run(
            [
                "wsl",
                "bash",
                "-c",
                "cd /mnt/c/repos/DTblocklyGPT/ros2_ws && source install/setup.bash && ros2 run cobotta_rest_api flask_node",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        subprocess.run(
            [
                "wsl",
                "bash",
                "-c",
                "cd /mnt/c/repos/DTblocklyGPT/ros2_ws && source install/setup.bash && ros2 run cobotta_rest_api cobotta_node",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        subprocess.run(
            [
                "wsl",
                "bash",
                "-c",
                "cd /mnt/c/repos/DTblocklyGPT/ros2_ws/Cobotta && ign gazebo -v 4 worldCobottaDensoLimitsOptimised2.sdf",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        subprocess.run(
            [
                "wsl",
                "bash",
                "-c",
                "cd /mnt/c/repos/DTblocklyGPT/ros2_ws/Cobotta && ros2 run ros_gz_bridge parameter_bridge --ros-args -p config_file:=../Cobotta/map.yaml",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    except Exception as e:
        print(str(e))


def simulate_ros_move(
    joint_1: float,
    joint_2: float,
    joint_3: float,
    joint_4: float,
    joint_5: float,
    joint_6: float,
    hand: float,
    joint_abs: bool = False,
):
    ros_params = {
        "joint_1": joint_1,
        "joint_2": joint_2,
        "joint_3": joint_3,
        "joint_4": joint_4,
        "joint_5": joint_5,
        "joint_6": joint_6,
        "hand": hand,
        "joint_abs": joint_abs,
    }
    try:
        _bridge.move_joints(ros_params)
    except Exception as e:
        print(f"[SIMULATOR] simulate_ros_move failed params={ros_params}: {e}")


def _parse_hand_mm(message: str):
    """Parse the {"hand_mm": float} JSON cobotta_node piggybacks on a move response."""
    try:
        return float(loads(message)["hand_mm"])
    except Exception:
        return None


def _verify_hw_arrival(target_joints, tol_deg=HW_VERIFY_TOL_DEG, timeout_s=HW_VERIFY_TIMEOUT_S) -> bool:
    """Poll the real arm's encoders until they match the commanded pose or timeout.

    The encoder timer publishes at 10 Hz and skips ticks while a move holds the
    B-CAP lock, so a single read right after move_target() returns can be stale.
    move_target() is synchronous — the arm is already stopped by the time we get
    here — so a fresh CurJnt sample lands within one or two 100 ms ticks; the
    poll window absorbs that instead of trusting the first read.
    """
    deadline = time.monotonic() + timeout_s
    last_seen = None
    while time.monotonic() < deadline:
        try:
            real = _bridge.get_actual_joints_real()
        except Exception:
            real = []
        if len(real) >= 6:
            last_seen = real[:6]
            deltas = [abs(t - a) for t, a in zip(target_joints, last_seen)]
            if max(deltas) <= tol_deg:
                return True
        time.sleep(0.2)

    _abort_task(
        f"twin divergence: commanded {list(target_joints)} but encoders read "
        f"{last_seen} (tol {tol_deg}°)"
    )
    return False


def _verify_hw_grasp(commanded_close_mm) -> bool:
    """After a pick's gripper-close move, confirm something stopped the fingers.

    The grasp planner sets commanded_close_mm below the object's width on
    purpose. If the real fingers reached (close to) that fully-closed value,
    nothing was between them — the object was missed.
    """
    if not _hw_drive_active() or _LAST_HW_HAND_MM is None:
        return True  # no data — don't block the sim on a readout we don't have
    if _LAST_HW_HAND_MM <= commanded_close_mm + HW_GRASP_SLIP_TOL_MM:
        _abort_task(
            f"missed grasp: hand closed to {_LAST_HW_HAND_MM:.1f}mm "
            f"(commanded {commanded_close_mm:.1f}mm) — object not detected between fingers"
        )
        return False
    return True


def _send_hw_target(joints, hand, hand_only=False) -> bool:
    """Forward one key pose to the real arm via /api/move-target (blocking).

    Returns False and aborts the running task on any hardware failure (HTTP
    error, service rejection, or — for arm moves — the real encoders not
    reaching the commanded pose). Sim-only mode (hardware not requested this
    run, or server not armed) always returns True without contacting the bridge.
    """
    global _LAST_HW_HAND_MM
    if not _hw_drive_active():
        return True
    try:
        payload = {"hand": hand, "hand_only": hand_only}
        if not hand_only:
            j1, j2, j3, j4, j5, j6 = joints
            payload.update({"j1": j1, "j2": j2, "j3": j3, "j4": j4, "j5": j5, "j6": j6})
        result = _bridge.move_target(payload)
    except Exception as e:
        _abort_task(f"real arm unreachable: {e}")
        return False

    if not result.get("ok"):
        _abort_task(f"real arm move failed: {result.get('message', 'unknown')}")
        return False

    _LAST_HW_HAND_MM = _parse_hand_mm(result.get("message", ""))

    if not hand_only and not SIMULATION_STOP_EVENT.is_set():
        return _verify_hw_arrival(joints)
    return True


def smooth_move(target_joints, hand, duration_s=1.8, hz=20):
    """
    Interpolates movement from current state to target state with ease-in-out curve.
    Uses the currently stored STATE as starting point.
    """
    start_joints, start_hand = get_current_state()

    # Calculate angular distance to check if movement is needed
    max_delta = max(abs(t - s) for t, s in zip(target_joints, start_joints))
    hand_delta = abs(hand - start_hand)

    if max_delta < 0.01 and hand_delta < 0.5:
        simulate_ros_move(*target_joints, hand)
        set_current_state(target_joints, hand)
        _send_hw_target(target_joints, hand)
        _interruptible_sleep(duration_s)
        return
    steps = max(2, int(duration_s * hz))
    dt = duration_s / steps

    waypoints = []
    for i in range(1, steps + 1):
        a = i / steps
        a = 0.5 - 0.5 * math.cos(math.pi * a)  # ease-in-out

        q = [
            start_joints[k] + a * (target_joints[k] - start_joints[k])
            for k in range(6)
        ]

        current_hand_interp = start_hand + a * (hand - start_hand)

        waypoints.append({
            "j1": q[0],
            "j2": q[1],
            "j3": q[2],
            "j4": q[3],
            "j5": q[4],
            "j6": q[5],
            "hand": current_hand_interp,
            "dt": dt
        })

    try:
        _bridge.move_path(waypoints)
    except Exception as e:
        print(f"[SIMULATOR] Failed to send move-path: {e}")

    set_current_state(target_joints, hand)
    _send_hw_target(target_joints, hand)
    _interruptible_sleep(duration_s)


def send_waypoints(joints_list, hand, dt):
    """Send a pre-computed IK path as a single move-path POST (no interpolation)."""
    if not joints_list:
        return
    waypoints = [
        {
            "j1": float(q[0]), "j2": float(q[1]), "j3": float(q[2]),
            "j4": float(q[3]), "j5": float(q[4]), "j6": float(q[5]),
            "hand": float(hand), "dt": float(dt)
        }
        for q in joints_list
    ]
    try:
        _bridge.move_path(waypoints)
    except Exception as e:
        print(f"[SIMULATOR] Failed to send move-path: {e}")
    set_current_state(joints_list[-1], hand)
    _send_hw_target(joints_list[-1], hand)
    _interruptible_sleep(len(joints_list) * dt)


def build_vertical_ik_path(x_rel, y_rel, z_start, z_end, grasp_yaw, seed_joints, n=10):
    """
    Builds a vertical cartesian path by solving IK at very close intermediate Z points.
    Checks for kinematic branch jumps.
    """
    zs = np.linspace(z_start, z_end, n)
    path = []
    seed = seed_joints

    for z in zs:
        q = solve_gazebo_ik(x_rel, y_rel, float(z), grasp_yaw, seed_joints=seed)
        if not q:
            print("[SIMULATOR] Vertical path IK failed at z =", z)
            return None

        # Check for kinematic jumps
        if seed is not None:
            max_delta = max(abs(q_new - q_old) for q_new, q_old in zip(q, seed))
            if max_delta > KINEMATIC_JUMP_THRESHOLD_DEG:
                print(f"[SIMULATOR] Kinematic jump detected: max delta {max_delta} > {KINEMATIC_JUMP_THRESHOLD_DEG} degrees at z={z}")
                return None

        path.append(q)
        seed = q

    return path


def build_cartesian_ik_path(x_start, y_start, z_start, x_end, y_end, z_end, grasp_yaw, seed_joints, n=10):
    """
    Builds a Cartesian path between two 3D points, solving IK at each step.
    Seed-chained: each step seeded from previous solution. Checks for kinematic jumps.
    """
    xs = np.linspace(x_start, x_end, n)
    ys = np.linspace(y_start, y_end, n)
    zs = np.linspace(z_start, z_end, n)
    path = []
    seed = seed_joints

    for x, y, z in zip(xs, ys, zs):
        q = solve_gazebo_ik(float(x), float(y), float(z), grasp_yaw, seed_joints=seed)
        if not q:
            print(f"[SIMULATOR] Cartesian IK failed at x={x:.3f}, y={y:.3f}, z={z:.3f}")
            return None
        if seed is not None:
            max_delta = max(abs(q_new - q_old) for q_new, q_old in zip(q, seed))
            if max_delta > KINEMATIC_JUMP_THRESHOLD_DEG:
                print(f"[SIMULATOR] Kinematic jump {max_delta:.1f}° at x={x:.3f}, y={y:.3f}, z={z:.3f}")
                return None
        path.append(q)
        seed = q

    return path


def _reachable_place_carry_z(x_rel, y_rel, z_carry, z_floor, grasp_yaw, seed_joints):
    """Lower z_carry to the reachability ceiling above the place slot.

    The reachable transit height isn't uniform across the rack: targets
    farther from the arm's centerline (larger |y_rel|) sit lower in the
    reach envelope at a fixed top-down orientation — measured offline, the
    tube rack's outer slot (y=-0.237) tops out around z=0.205 while the
    other two slots reach the full z=0.213 carry height fine. Stepping down
    from the requested z_carry until the column above the slot solves IK
    finds that ceiling per-target instead of hardcoding it; never steps
    below z_floor (the descent hover), so the transit still clears the rack
    walls. If nothing down to z_floor solves, returns z_carry unchanged and
    lets the transit build below fail/abort as it already does — no
    fake-place from this helper either way.
    """
    if solve_gazebo_ik(x_rel, y_rel, z_carry, grasp_yaw, seed_joints=seed_joints):
        return z_carry
    z = z_carry
    while z - 0.01 >= z_floor:
        z -= 0.01
        if solve_gazebo_ik(x_rel, y_rel, z, grasp_yaw, seed_joints=seed_joints):
            print(f"[PLACE] carry height lowered {z_carry:.3f}→{z:.3f} "
                  f"for reach at (x={x_rel:.2f},y={y_rel:.2f})")
            return z
    return z_carry


ROS_OPEN_GRIPPER = 30
ROS_GRIPPER_GENTLE_CLOSE = 10
ROS_CLOSE_GRIPPER_WITH_OBJECT = 10  # Default safe close gap (10mm) for generic blocks

CARRY_Z_MIN = 0.15    # minimum carry height above robot base (Gazebo relative, m)
CARRY_MARGIN = 0.03   # safety margin above highest obstacle in workspace
# Top of the IK-reliable transit band — see testing/test_ik_regression.py
# test_transit_z_sweep. Clamping z_carry into this band is a second line of
# defense alongside the z-adaptive seed (_heuristic_seed_j235); raise it only
# after the sweep confirms IK is solid past this height.
CARRY_Z_MAX = 0.23

# Max per-joint change (deg) between consecutive IK solutions along a Cartesian
# path. A larger jump signals an elbow flip / singularity, so the path is rejected.
KINEMATIC_JUMP_THRESHOLD_DEG = 30.0

# Gripper closes this many mm tighter than the object width so the fingers grip
# firmly rather than just touching the surface.
GRIPPER_GRIP_CLEARANCE_MM = 4.0

# Cobotta hand max opening (mm). Objects wider than this cannot be top-grasped;
# the planner marks them infeasible (a side grasp would be Phase 3, out of scope).
MAX_GRIP_WIDTH_MM = 30.0

# DetachableJoint topics (plugin in Cobotta.sdf, parent_link=link_j6, child_model=object)
ATTACH_CMD = "gz topic -t /model/Cobotta/detachable_joint/attach -m gz.msgs.Empty -p 'unused: true'"
DETACH_CMD = "gz topic -t /model/Cobotta/detachable_joint/detach -m gz.msgs.Empty -p 'unused: true'"

# Plugin publishes its weld state on request. Subscribe (bounded, -d) in the
# background, then publish attach, then wait for both — the echo must already
# be listening before the publish fires, so subscribe comes first in the shell.
ATTACH_STATE_TOPIC = "/model/Cobotta/detachable_joint/state"
ATTACH_AND_VERIFY_CMD = (
    f"gz topic -e -d 3 -t {ATTACH_STATE_TOPIC} & "
    "sleep 0.5; "
    f"{ATTACH_CMD}; "
    "wait"
)


# Empirically measured on this dev VM (2026-07-10), replaying the real pick
# cadence: each `gz topic -t/-e` CLI call is a fresh short-lived process, and
# gz-transport's peer discovery either completes in time or doesn't — waiting
# longer before a single publish doesn't move that floor (tested up to 1.5s
# pre-publish). What works is re-rolling on a fresh publish+subscribe pair.
# 2 attempts (the original figure) measured 8/15 (~53%). With the harness
# mirroring production's detach-BEFORE-delete ordering (delete_spawned_
# object_and_place always detaches first — see its docstring), 10 attempts
# at 0.4s spacing measured 20/20; the one hard failure seen in an earlier,
# less faithful harness run (delete without a prior detach) reproduced the
# known gz-sim8 re-attach quirk this whole gate exists to catch, not a false
# negative — so that case is correctly an abort, not evidence of an
# unreliable retry budget.
_ATTACH_MAX_ATTEMPTS = 10
_ATTACH_RETRY_DELAY_S = 0.4


def attach_object_to_gripper() -> bool:
    """Weld 'object' to link_j6 and verify via the DetachableJoint state topic.

    A blind publish can succeed (exit 0) while gz-sim silently refuses the
    re-attach (known gz-sim8 quirk on delete+respawn of a same-named entity),
    leaving the object behind on lift — so this reads the state topic back
    instead of trusting the publish's own exit code.
    """
    for attempt in range(1, _ATTACH_MAX_ATTEMPTS + 1):
        print(f"[GRASP] Attach attempt {attempt}/{_ATTACH_MAX_ATTEMPTS}: welding 'object' to link_j6")
        out = _shell_output(ATTACH_AND_VERIFY_CMD) or ""
        if '"attached"' in out or ("attached" in out and "detached" not in out):
            print(f"[GRASP] Attach verified: state topic reports 'attached' (attempt {attempt})")
            return True
        print(f"[GRASP] Attach attempt {attempt} unverified (state output: {out.strip()[:120] or 'no message'})")
        if attempt < _ATTACH_MAX_ATTEMPTS:
            _interruptible_sleep(_ATTACH_RETRY_DELAY_S)
    return False


def detach_object_from_gripper() -> bool:
    print("[GRASP] Detach: releasing 'object' from DetachableJoint weld")
    ok = launch_wsl_ros_command(DETACH_CMD)
    if not ok:
        print("[GRASP] WARNING: detach command failed (gz topic returned error)")
    return ok


def set_object_world_pose(x: float, y: float, z: float, yaw: float = 0.0) -> bool:
    """Teleport Gazebo model 'object' to the given world pose. Hard gate before weld."""
    qz = math.sin(yaw / 2.0)
    qw = math.cos(yaw / 2.0)
    cmd = (
        'gz service -s /world/worldCobotta/set_pose '
        '--reqtype gz.msgs.Pose --reptype gz.msgs.Boolean '
        '--timeout 3000 '
        f'--req \'name: "object"; '
        f'position: {{x: {x:.4f}, y: {y:.4f}, z: {z:.4f}}}; '
        f'orientation: {{x: 0, y: 0, z: {qz:.4f}, w: {qw:.4f}}}\''
    )
    ok = launch_wsl_ros_command(cmd, expect_reply_true=True)
    if not ok:
        print(f"[GRASP] set_object_world_pose FAILED (x={x:.4f} y={y:.4f} z={z:.4f})")
    return ok


# Gazebo world spawn positions (absolute, Gazebo frame)
OBJECT_SPAWN_X = -9.05          # X of object spawn point
OBJECT_SPAWN_Y = -1.48
LOCATION_SPAWN_X = -8.8         # X of location model spawn point
LOCATION_SPAWN_Y = -1.41

# Robot base world XY pose in Gazebo (worldCobotta.sdf, Cobotta include pose).
# The Z counterpart (ROBOT_BASE_Z) lives in calibration.py as the SSOT for the
# TABLE_TOP_Z_ABS / PICK_Z_REF_OFFSET frame invariant asserted there — this
# module only ever needs the already-world-absolute TABLE_TOP_Z_ABS, never
# ROBOT_BASE_Z directly.
ROBOT_BASE_X = -9.0
ROBOT_BASE_Y = -1.2


def simulate_ros_pick(obj, sdf_name: str = "", do_attach: bool = True,
                      pick_x_rel: float = None, pick_y_rel: float = None,
                      obj_min_z: float = None):
    try:
        # Sync state from ROS first to anchor the IK seeds. Abort if it fails —
        # planning from a stale seed risks singularities / collisions.
        if not sync_current_state_from_ros():
            _abort_task("PICK: could not sync joint state from ROS")
            return

        # Object relative coordinates — use the deterministic spawn XY (Phase 1)
        x_rel = pick_x_rel if pick_x_rel is not None else DEFAULT_PICK_X_REL
        y_rel = pick_y_rel if pick_y_rel is not None else DEFAULT_PICK_Y_REL

        # Phase 2: normalize the object from collision geometry and plan a top-grasp.
        # No object-name branch; infeasible (e.g. too wide for the hand) → skip cleanly.
        model = normalize_object_for_grasp(sdf_name, obj)
        plan = plan_pick_for_object(model, x_rel, y_rel)
        if not plan.feasible:
            print(f"[GRASP] infeasible: {plan.reason} — skipping pick for '{sdf_name}' "
                  f"(type={model.collision_type}, width={model.graspable_width * 1000:.1f}mm)")
            return
        if obj_min_z is None:
            obj_min_z = model.min_z
        z_pick = plan.z_pick
        grasp_yaw = plan.tool_yaw
        hand_close = plan.hand_close
        logger.info("pick_plan", extra={
            "sdf_name": sdf_name,
            "collision_type": model.collision_type,
            "graspable_width_mm": round(model.graspable_width * 1000, 1),
            "z_pick_target": round(z_pick, 4),
            "tool_yaw": round(grasp_yaw, 4),
            "hand_close": hand_close,
            "notes": plan.planning_notes,
        })
        print(f"[PICK-PLAN] type={model.collision_type} z_pick={z_pick:.4f} "
              f"yaw={grasp_yaw:.3f} hand_close={hand_close} "
              f"width={model.graspable_width * 1000:.1f}mm src={model.source}")

        z_approach = z_pick + 0.12
        z_pregrasp = z_pick + 0.01

        current_joints, _ = get_current_state()

        # 1. Approach (high clearance)
        q_approach = solve_gazebo_ik(x_rel, y_rel, z_approach, grasp_yaw, seed_joints=current_joints)
        if not q_approach:
            _abort_task(f"pick approach IK failed at x={x_rel:.3f} y={y_rel:.3f} z={z_approach:.3f}")
            return

        debug_fk(q_approach, label="Approach")

        smooth_move(q_approach, ROS_OPEN_GRIPPER, duration_s=2.0)

        # 2. Rampa verticale d'approccio
        vertical_path = build_vertical_ik_path(
            x_rel, y_rel, z_approach, z_pregrasp, grasp_yaw,
            seed_joints=q_approach, n=10
        )
        if not vertical_path:
            _abort_task("pick vertical approach IK path failed")
            return
        send_waypoints(vertical_path, ROS_OPEN_GRIPPER, dt=0.20)

        # 3. Rampa verticale finale al punto di pick
        final_path = build_vertical_ik_path(
            x_rel, y_rel, z_pregrasp, z_pick, grasp_yaw,
            seed_joints=vertical_path[-1], n=6
        )
        if not final_path:
            _abort_task("pick final descent IK path failed")
            return

        send_waypoints(final_path, ROS_OPEN_GRIPPER, dt=0.20)
        pick_joints = final_path[-1]
        debug_fk(pick_joints, label="Pick Point")

        # FK guard: verify TCP is within tolerance of pick target before closing
        target_urdf = np.array([-y_rel, x_rel, z_pick + URDF_GAZEBO_Z_OFFSET])
        pos_err, _ = fk_position_error(pick_joints, target_urdf)
        if pos_err > IK_POS_TOL:
            _abort_task(f"pick FK guard: pos_err={pos_err * 1000:.1f}mm > {IK_POS_TOL * 1000:.0f}mm")
            return

        # hand_close already comes from plan_pick_for_object (graspable_width).
        # Snap + weld with the gripper still OPEN so the object is NOT in contact with
        # the fingers at the attach frame (Gazebo: reattach unsupported during contact).
        # Fingers close AFTER the weld below (object already rigid → contact harmless).

        # Snap object to exact TCP grasp pose before weld (hard gate: abort if set_pose fails).
        # snap_z = TABLE_TOP_Z_ABS - sdf_min_z puts model origin at resting height, which
        # coincides with TCP grasp height by design (PICK_Z_REF_OFFSET = TABLE_TOP_Z_ABS - ROBOT_BASE_Z).
        if do_attach:
            snap_x = ROBOT_BASE_X + x_rel
            snap_y = ROBOT_BASE_Y + y_rel
            if obj_min_z is None:
                _, _, obj_min_z = get_sdf_dimensions(sdf_name)
            snap_z = TABLE_TOP_Z_ABS - (obj_min_z or 0.0) + PICK_Z_FINE_TUNE
            print(f"[GRASP] snap pose x={snap_x:.4f} y={snap_y:.4f} z={snap_z:.4f} yaw={grasp_yaw:.4f}")
            if not set_object_world_pose(snap_x, snap_y, snap_z, yaw=grasp_yaw):
                _abort_task("pick snap-to-TCP failed (set_pose) — refusing to weld, would float")
                return
            # Object is already held at rest, so the snap is authoritative; tight
            # delay just lets the re-parent settle before the weld.
            _interruptible_sleep(0.05)
            if not attach_object_to_gripper():
                _abort_task(
                    "pick weld failed: DetachableJoint never reported 'attached' "
                    "(2 attempts) — object would be left behind"
                )
                return
            _interruptible_sleep(0.2)
        else:
            print("[GRASP] Attach skipped (do_attach=False: spawn failed or disabled)")

        # Close fingers for the visual grip — object already welded, contact now harmless.
        smooth_move(pick_joints, hand_close, duration_s=0.7)
        _interruptible_sleep(0.3)

        # Real arm only: fingers fully closed with nothing between them means the
        # pick missed the object even though the sim twin already welded it.
        if not _verify_hw_grasp(hand_close):
            return

        # 4. Lift Cartesian Z-down to carry height (preserves tool orientation)
        z_carry = z_approach + CARRY_MARGIN
        lift_path = build_vertical_ik_path(
            x_rel, y_rel, z_pick, z_carry, grasp_yaw,
            seed_joints=pick_joints, n=8
        )
        if lift_path:
            send_waypoints(lift_path, hand_close, dt=0.15)
            carry_joints = lift_path[-1]
        else:
            smooth_move(q_approach, hand_close, duration_s=1.5)
            carry_joints = q_approach

        # Store pick context for place phase (gantry transit Z-down)
        simulation_recursive_blockly_parser.last_pick_x = x_rel
        simulation_recursive_blockly_parser.last_pick_y = y_rel
        simulation_recursive_blockly_parser.last_pick_z_carry = z_carry
        simulation_recursive_blockly_parser.last_pick_grasp_yaw = grasp_yaw
        simulation_recursive_blockly_parser.last_pick_hand_close = hand_close
        simulation_recursive_blockly_parser.last_pick_carry_joints = carry_joints
        # Arm stays at carry pose Z-down with object; no home until place releases

    except Exception as e:
        _abort_task(f"pick failed: {e}")


def simulate_ros_initial_position(gripper_open: bool = True, hand_value: int = None):
    try:
        J1_INITIAL_POSITION = 0
        J2_INITIAL_POSITION = 0
        J3_INITIAL_POSITION = 90
        J4_INITIAL_POSITION = 0
        J5_INITIAL_POSITION = 0
        J6_INITIAL_POSITION = 0

        if hand_value is None:
            hand_val = ROS_OPEN_GRIPPER if gripper_open else 0
        else:
            hand_val = hand_value

        smooth_move(
            [J1_INITIAL_POSITION,
             J2_INITIAL_POSITION,
             J3_INITIAL_POSITION,
             J4_INITIAL_POSITION,
             J5_INITIAL_POSITION,
             J6_INITIAL_POSITION],
            hand_val,
            duration_s=2.0
        )

    except Exception as e:
        print(str(e))


def simulate_ros_place(picked_obj_name: str = "", objectsOfUser=None, location_name: str = "collector"):
    try:
        # Sync state from ROS. Abort if it fails — a stale IK seed risks
        # singularities / collisions on the descent.
        if not sync_current_state_from_ros():
            print("[ROBOT] PLACE aborted: could not sync joint state from ROS")
            return

        # Retrieve picked object's metrics if available
        obj = None
        if objectsOfUser is not None and picked_obj_name:
            obj = objectsOfUser.filter(name=picked_obj_name).first()

        height_m, width_m = resolve_object_metrics(obj, picked_obj_name)
        if height_m is None or width_m is None:
            print(f"[ROBOT] PLACE aborted: could not resolve dimensions for '{picked_obj_name}'")
            return
        width_mm = width_m * 1000.0

        # Close gap
        hand_close = int(max(0.0, min(30.0, width_mm - 0.5)))

        # Target coordinates (slot cycling for multi-slot locations)
        x_rel = DEFAULT_PLACE_X_REL
        safe_loc_name = location_name.replace(" ", "_").lower()
        slot_cfg = LOCATION_PROFILES.get(safe_loc_name)
        if slot_cfg:
            slot_idx = getattr(simulation_recursive_blockly_parser, "place_slot_index", 0)
            offsets = slot_cfg["slot_y_offsets"]
            y_offset = offsets[slot_idx % len(offsets)]
            y_rel = DEFAULT_PLACE_Y_REL + y_offset
            simulation_recursive_blockly_parser.place_slot_index = slot_idx + 1
            print(f"[SIMULATOR] Slot {slot_idx % len(offsets)}: y_rel={y_rel:.3f}")
        else:
            y_rel = DEFAULT_PLACE_Y_REL

        loc_height = resolve_location_metrics(location_name)

        # Container detection: lower object into interior rather than depositing on rim
        _, floor_height, is_container = get_location_profile(safe_loc_name)

        # Calculate dynamic grip Z offset
        if height_m > 0.04:
            z_grip = max(height_m / 2.0, height_m - 0.03)
        else:
            z_grip = height_m / 2.0

        if is_container and floor_height is not None:
            # Place object 3 mm above the floor interior
            z_place = PICK_Z_REF_OFFSET + floor_height + 0.003 + z_grip
            print(f"[SIMULATOR] Container place: floor={floor_height:.3f} z_place={z_place:.3f}")
        else:
            z_place = PICK_Z_REF_OFFSET + loc_height + 0.02 + z_grip
        z_up = z_place + 0.12

        grasp_yaw = getattr(obj, "grasp_yaw", 0.0) or 0.0

        current_joints, current_hand = get_current_state()

        # Read pick context for loaded gantry transit
        pick_x = getattr(simulation_recursive_blockly_parser, 'last_pick_x', None)
        pick_y = getattr(simulation_recursive_blockly_parser, 'last_pick_y', None)
        pick_z_carry = getattr(simulation_recursive_blockly_parser, 'last_pick_z_carry', None)
        pick_grasp_yaw = getattr(simulation_recursive_blockly_parser, 'last_pick_grasp_yaw', grasp_yaw)
        pick_hand_close = getattr(simulation_recursive_blockly_parser, 'last_pick_hand_close', None)
        pick_carry_joints = getattr(simulation_recursive_blockly_parser, 'last_pick_carry_joints', None)
        has_pick_context = pick_x is not None and pick_carry_joints is not None

        if pick_hand_close is not None:
            hand_close = pick_hand_close

        if has_pick_context:
            z_carry = max(pick_z_carry, z_up, CARRY_Z_MIN) + CARRY_MARGIN
            # Clamp into the IK-reliable band — never below the clearance this
            # place actually needs (z_up + a hair), even if that's above
            # CARRY_Z_MAX; the transit build below will then fail cleanly and
            # abort (no silent fake-place) rather than clip clearance short.
            z_carry = min(z_carry, max(CARRY_Z_MAX, z_up + 0.005))

            # Some place slots (e.g. the rack's outer slot) sit lower in the
            # reach envelope than others at the same carry height — lower
            # z_carry to whatever this specific slot can actually reach
            # rather than aborting a transit that a few cm less altitude
            # would have cleared.
            z_carry = _reachable_place_carry_z(
                x_rel, y_rel, z_carry, max(z_up, CARRY_Z_MIN), pick_grasp_yaw, pick_carry_joints)

            # 0. Pre-lift: bridge gap between pick z_carry and required z_carry
            seed_for_transit = pick_carry_joints
            if z_carry > pick_z_carry + 0.005:
                prelift_path = build_vertical_ik_path(
                    pick_x, pick_y, pick_z_carry, z_carry, pick_grasp_yaw,
                    seed_joints=pick_carry_joints, n=8
                )
                if prelift_path:
                    send_waypoints(prelift_path, hand_close, dt=0.15)
                    seed_for_transit = prelift_path[-1]
                    print(f"[SIMULATOR] Pre-lift OK: z={pick_z_carry:.3f} → z={z_carry:.3f}")

            # 1. Horizontal transit Cartesian Z-down: above pick → above place
            transit_path = build_cartesian_ik_path(
                pick_x, pick_y, z_carry,
                x_rel, y_rel, z_carry,
                pick_grasp_yaw, seed_joints=seed_for_transit, n=12
            )
            if transit_path:
                send_waypoints(transit_path, hand_close, dt=0.15)
                q_above_place = transit_path[-1]
                print(f"[SIMULATOR] Gantry transit OK: ({pick_x:.2f},{pick_y:.2f}) → ({x_rel:.2f},{y_rel:.2f}) @ z={z_carry:.3f}")
            else:
                # No degraded fallback: an arm that stayed at the pick column
                # would still detach+snap the object below, faking a place
                # that never physically happened. Abort instead — the twin
                # and the real arm both stop, and the frontend gets a reason.
                _abort_task(
                    f"place transit IK failed at z_carry={z_carry:.3f} "
                    f"({pick_x:.2f},{pick_y:.2f}) → ({x_rel:.2f},{y_rel:.2f})"
                )
                return

            # 2. Vertical descent Cartesian Z-down: z_carry → z_place
            descent_path = build_vertical_ik_path(
                x_rel, y_rel, z_carry, z_place, pick_grasp_yaw,
                seed_joints=q_above_place, n=10
            )
            if not descent_path:
                _abort_task(f"place descent IK failed at ({x_rel:.2f},{y_rel:.2f}) z={z_place:.3f}")
                return
            send_waypoints(descent_path, hand_close, dt=0.20)
            place_joints = descent_path[-1]
            target_urdf_place = np.array([-y_rel, x_rel, z_place + URDF_GAZEBO_Z_OFFSET])
            place_pos_err, _ = fk_position_error(place_joints, target_urdf_place)
            print(f"[PLACE] FK guard: pos_err={place_pos_err * 1000:.1f}mm (x={x_rel:.3f} y={y_rel:.3f} z={z_place:.3f})")
            if place_pos_err > IK_POS_TOL:
                _abort_task(f"place FK guard: {place_pos_err * 1000:.1f}mm off target — refusing to release")
                return
            q_retreat = q_above_place

        else:
            # No pick context (place called without a preceding pick this run).
            print("[SIMULATOR] No pick context — solving place approach directly")
            q_up = solve_gazebo_ik(x_rel, y_rel, z_up, grasp_yaw, seed_joints=current_joints)
            if not q_up:
                _abort_task(f"place approach IK failed at ({x_rel:.2f},{y_rel:.2f}) z={z_up:.3f}")
                return
            smooth_move(q_up, hand_close, duration_s=2.0)

            vertical_path = build_vertical_ik_path(
                x_rel, y_rel, z_up, z_place, grasp_yaw,
                seed_joints=q_up, n=8
            )
            if not vertical_path:
                _abort_task(f"place descent IK failed at ({x_rel:.2f},{y_rel:.2f}) z={z_place:.3f}")
                return
            send_waypoints(vertical_path, hand_close, dt=0.20)
            place_joints = vertical_path[-1]
            target_urdf_place = np.array([-y_rel, x_rel, z_place + URDF_GAZEBO_Z_OFFSET])
            place_pos_err, _ = fk_position_error(place_joints, target_urdf_place)
            if place_pos_err > IK_POS_TOL:
                _abort_task(f"place FK guard: {place_pos_err * 1000:.1f}mm off target — refusing to release")
                return
            q_retreat = q_up

        # 3. Detach → snap object to slot → open gripper
        detach_object_from_gripper()
        _interruptible_sleep(0.1)
        # Snap-to-slot: teleport object to exact slot centre so it always lands in the hole.
        # Best-effort (not a hard gate): if set_pose fails, log and continue.
        snap_x = ROBOT_BASE_X + x_rel
        snap_y = ROBOT_BASE_Y + y_rel
        _, _, obj_place_min_z = get_sdf_dimensions(picked_obj_name)
        if is_container and floor_height is not None:
            snap_z_slot = TABLE_TOP_Z_ABS + floor_height - (obj_place_min_z or 0.0)
        else:
            snap_z_slot = TABLE_TOP_Z_ABS + loc_height - (obj_place_min_z or 0.0)
        print(f"[PLACE] snap-to-slot x={snap_x:.4f} y={snap_y:.4f} z={snap_z_slot:.4f} yaw={grasp_yaw:.4f}")
        if not set_object_world_pose(snap_x, snap_y, snap_z_slot, yaw=grasp_yaw):
            print("[PLACE] snap-to-slot failed (best-effort: object may miss)")
        _interruptible_sleep(0.2)
        smooth_move(place_joints, ROS_OPEN_GRIPPER, duration_s=0.6)
        _interruptible_sleep(0.5)

        # 4. Retreat up (empty gripper from here: joint interp OK)
        smooth_move(q_retreat, ROS_OPEN_GRIPPER, duration_s=1.5)

        # Persist the placed object under its own identity now that the arm is
        # clear of the slot — otherwise the next pick's cleanup of the reusable
        # "object" entity would delete the item that was just placed.
        _persist_placed_object(picked_obj_name, snap_x, snap_y, snap_z_slot, yaw=grasp_yaw)

        # 5. Return to home
        simulate_ros_initial_position(gripper_open=True)

        # Clear pick context
        simulation_recursive_blockly_parser.last_pick_carry_joints = None
        simulation_recursive_blockly_parser.last_pick_x = None

    except Exception as e:
        _abort_task(f"place failed: {e}")


def simulate_ros_action(action_points: list = []):
    """Play back a Skill's recorded waypoints on the Gazebo twin and, when
    hardware drive is active, on the real arm too (one verified PTP move per
    waypoint via _send_hw_target — the plain move-path used elsewhere only
    forwards the final pose to hardware, which would collapse an oscillating
    skill like "shake" into a single point). Gripper aperture is held at
    whatever the arm currently has, not forced open, so a sample carried
    into the skill isn't dropped mid-sequence.
    """
    try:
        if len(action_points) == 0:
            return
        sync_current_state_from_ros()
        _, cur_hand = get_current_state()
        waypoints = []
        for point in action_points:
            waypoints.append({
                "j1": point["j1"],
                "j2": point["j2"],
                "j3": point["j3"],
                "j4": point["j4"],
                "j5": point["j5"],
                "j6": point["j6"],
                "hand": cur_hand,
                "dt": 1.0
            })
        try:
            _bridge.move_path(waypoints)
        except Exception as e:
            print(f"[SIMULATOR] Failed to send move-path: {e}")

        if _hw_drive_active():
            for point in action_points:
                joints = [point["j1"], point["j2"], point["j3"], point["j4"], point["j5"], point["j6"]]
                if not _send_hw_target(joints, cur_hand):
                    return
        else:
            _interruptible_sleep(len(waypoints) * 1.0)

        last = action_points[-1]
        set_current_state(
            [last["j1"], last["j2"], last["j3"], last["j4"], last["j5"], last["j6"]],
            cur_hand,
        )

    except Exception as e:
        print(str(e))


def reset_simulation_world():
    try:
        delete_object = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "object"'"""
        delete_location = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "location"'"""

        # Reset slot cycling counter and spawned-object tracking.
        simulation_recursive_blockly_parser.place_slot_index = 0
        _spawned_in_world.clear()

        # Detach before delete: removing a welded child without detaching first
        # can leave the plugin in a stale attached state across the next spawn.
        print("[GRASP] Reset: detaching before world cleanup")
        detach_object_from_gripper()
        _interruptible_sleep(0.2)

        # Delete failures are tolerated — entities may not exist on first run.
        if not launch_wsl_ros_command(delete_object):
            print("[SIMULATOR] reset: delete 'object' failed (may not exist)")
        _interruptible_sleep(0.3)
        if not launch_wsl_ros_command(delete_location):
            print("[SIMULATOR] reset: delete 'location' failed (may not exist)")

        _delete_placed_objects()
        _interruptible_sleep(1.0)
        simulate_ros_initial_position(gripper_open=True)
        _interruptible_sleep(3.0)
    except Exception as e:
        print(f"[SIMULATOR] reset_simulation_world failed: {e}")


def delete_spawned_object_and_place():
    """Remove temporary objects created during PICK/PLACE to allow
    repeating the sequence without resetting the entire world.

    Only the reusable "object" entity (the pick buffer) is touched here —
    persisted placed_* copies (see _persist_placed_object) are deliberately
    left alone so they survive across repeat() iterations; they're swept
    only on reset_simulation_world()/stop_simulation().
    """
    try:
        delete_object = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "object"'"""
        # Detach before delete: prevents stale weld state across repeated runs.
        print("[GRASP] Cleanup: detaching welded child before removing 'object'")
        detach_object_from_gripper()
        _interruptible_sleep(0.2)
        launch_wsl_ros_command(delete_object)
        _interruptible_sleep(0.4)
        _spawned_in_world.clear()
    except Exception as e:
        print(str(e))


def _persist_placed_object(sdf_name: str, x: float, y: float, z: float, yaw: float = 0.0) -> bool:
    """Give a just-placed object a permanent identity so it survives the next
    pick's cleanup of the reusable "object" entity.

    Delete "object" FIRST: spawning the placed_* copy at the same pose while
    the original still exists interpenetrates the two colliders (Gazebo
    reacts by exploding them apart). A failed delete skips the spawn — that
    naturally covers the failed-pick case, where "object" was never welded
    and there's nothing worth persisting anyway. Best-effort like the
    existing snap-to-slot: never aborts the task.
    """
    global _placed_seq
    safe_sdf_name = sdf_name.replace(" ", "_").lower()
    delete_object = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "object"'"""
    if not launch_wsl_ros_command(delete_object, expect_reply_true=True):
        print("[SIMULATOR] persist-placed: delete 'object' failed — skipping persistence")
        return False
    _interruptible_sleep(0.2)

    _placed_seq += 1
    placed_name = f"placed_{_placed_seq}"
    qz = math.sin(yaw / 2.0)
    qw = math.cos(yaw / 2.0)
    cmd = (
        'gz service -s /world/worldCobotta/create '
        '--reqtype gz.msgs.EntityFactory --reptype gz.msgs.Boolean '
        f'--timeout 5000 --req \'name: "{placed_name}"; '
        f'sdf_filename: "{os.path.join(BASE_DIR, "ros2_ws", "Cobotta", "objects", safe_sdf_name, "model.sdf")}"; '
        f'pose: {{position: {{x: {x:.4f}, y: {y:.4f}, z: {z:.4f}}}, '
        f'orientation: {{x: 0, y: 0, z: {qz:.4f}, w: {qw:.4f}}}}}\''
    )
    if not launch_wsl_ros_command(cmd, expect_reply_true=True):
        print(f"[SIMULATOR] persist-placed: spawn '{placed_name}' failed")
        return False
    _placed_in_world.append(placed_name)
    print(f"[SIMULATOR] Persisted placed object '{placed_name}' ({sdf_name}) at "
          f"x={x:.4f} y={y:.4f} z={z:.4f}")
    return True


def _delete_placed_objects():
    """Sweep every persisted placed_* entity (world reset / STOP)."""
    global _placed_in_world
    for name in _placed_in_world:
        cmd = (
            f'gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity '
            f'--reptype gz.msgs.Boolean --timeout 5000 --req \'type: MODEL, name: "{name}"\''
        )
        if not launch_wsl_ros_command(cmd):
            print(f"[SIMULATOR] sweep: delete '{name}' failed (may not exist)")
    _placed_in_world = []


# ─────────────────────────────────────────────────────────────────────────────
# CONDITION LOGGER HELPER
# ─────────────────────────────────────────────────────────────────────────────

def _log_condition(condition_block: dict, simulate_event: bool) -> bool:
    """Print a human-readable log for a condition block and return whether
    it is considered "fulfilled" in simulation.

    Rules:
    - timer_block: always waits the configured seconds → returns True
    - all other conditions: return the value of ``simulate_event``
    """
    block_type = condition_block.get("type", "")

    if block_type == EventsItems.FIND.value:
        obj_data = loads(condition_block["inputs"]["OBJECT"]["block"]["data"])
        label = f"Object detected '{obj_data.get('name', '?')}'"
    elif block_type == EventsItems.GESTURE.value:
        gesture = condition_block.get("fields", {}).get("GESTURE_TYPE", "THUMBS_UP")
        label = f"Gesture detected ({gesture})"
    elif block_type == EventsItems.TIMER.value:
        seconds = int(condition_block.get("fields", {}).get("SECONDS", 5))
        print(f"[CONDITION] Timer: waiting {seconds} seconds...")
        _interruptible_sleep(seconds)
        print("[CONDITION] Timer expired → condition fulfilled")
        return True
    elif block_type == EventsItems.VOICE.value:
        word = condition_block.get("fields", {}).get("VOICE_WORD", "YES")
        label = f"Voice command ({word})"
    else:
        label = f"Condition ({block_type})"

    status = "fulfilled" if simulate_event else "NOT fulfilled"
    print(f"[CONDITION] {label}: {status}")
    return bool(simulate_event)


def _detections_match(state: dict, coco_class: str, color: str = None) -> bool:
    """True if any live detection satisfies a (class, optional color) query.

    HSV blob detections ("cap") count for tube-like queries only: a coloured
    cap implies its tube, but must not satisfy unrelated classes ("apple").
    """
    accepted = {coco_class}
    if coco_class in ("bottle", "cup"):
        accepted.add("cap")
    for detection in state.get("detections", []):
        if detection.get("class") not in accepted:
            continue
        if color is not None and detection.get("color") != color:
            continue
        return True
    return False


def _wait_for_condition(condition_block: dict, timeout: int = None) -> bool:
    """Wait for a vision/human condition via Flask bridge (live mode only).

    On timeout: gesture/voice continue and post a timeout notification to the
    frontend. find_object instead hard-aborts the task — an unconfirmed object
    means the robot should not move on an assumption. Bridge-unreachable bypasses
    gesture and find_object with a structured log (a dead vision stack is not
    the same as "object absent").
    """
    if timeout is None:
        timeout = CONDITION_TIMEOUT_S
    block_type = condition_block.get("type", "")

    if block_type == EventsItems.GESTURE.value:
        gesture = condition_block.get("fields", {}).get("GESTURE_TYPE", "THUMBS_UP")
        # Probe bridge once before entering the wait loop.
        # If unreachable (camera/gesture engine off) bypass immediately.
        try:
            _bridge.get_vision_state()
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
            logger.warning("condition_bypassed", extra={"reason": "bridge_unreachable", "block": "gesture_block"})
            print(f"[CONDITION] Gesture bridge unreachable — bypassing gesture '{gesture}'")
            try:
                _bridge.notify("/api/human-step-timeout",
                               {"condition": "gesture", "value": gesture,
                                "bypass_reason": "bridge_unreachable"})
            except Exception:
                pass
            return True
        print(f"[CONDITION] Waiting for gesture: {gesture} (timeout {timeout}s)...")
        deadline = time.monotonic() + timeout
        detected = False
        while time.monotonic() < deadline:
            if SIMULATION_STOP_EVENT.is_set():
                break
            try:
                state = _bridge.get_vision_state()
                if state.get("gesture") == gesture:
                    detected = True
                    break
            except Exception:
                pass
            _interruptible_sleep(0.5)
        if not detected:
            print(f"[WARNING] Gesture '{gesture}' not detected within {timeout}s — continuing")
            try:
                _bridge.notify("/api/human-step-timeout",
                               {"condition": "gesture", "value": gesture})
            except Exception:
                pass
        else:
            print(f"[CONDITION] Gesture '{gesture}' detected!")
        return detected

    elif block_type == EventsItems.FIND.value:
        obj_data = loads(condition_block["inputs"]["OBJECT"]["block"]["data"])
        obj_name = obj_data.get("name", "")
        coco_class, color = parse_object_query(obj_name)
        # If bridge is unreachable, bypass immediately.
        try:
            state = _bridge.get_vision_state()
            if _detections_match(state, coco_class, color):
                print(f"[CONDITION] Object '{obj_name}' detected immediately!")
                return True
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
            logger.warning("condition_bypassed", extra={"reason": "bridge_unreachable", "block": "find_object_block"})
            print(f"[CONDITION] Vision bridge unreachable — bypassing find_object '{obj_name}'")
            try:
                _bridge.notify("/api/human-step-timeout",
                               {"condition": "object", "value": obj_name,
                                "bypass_reason": "bridge_unreachable"})
            except Exception:
                pass
            return True
        # Bridge reachable but object not seen yet — check Gazebo world as secondary.
        if obj_name in _spawned_in_world:
            logger.warning("condition_bypassed", extra={"reason": "object_in_world", "block": "find_object_block"})
            print(f"[CONDITION] Object '{obj_name}' in Gazebo world — bypassing find_object")
            return True
        color_note = f" color '{color}'" if color else ""
        print(f"[CONDITION] Waiting for object: '{obj_name}' → COCO '{coco_class}'{color_note} (timeout {timeout}s)...")
        deadline = time.monotonic() + timeout
        detected = False
        while time.monotonic() < deadline:
            if SIMULATION_STOP_EVENT.is_set():
                break
            try:
                state = _bridge.get_vision_state()
                if _detections_match(state, coco_class, color):
                    detected = True
                    break
            except Exception:
                pass
            _interruptible_sleep(0.5)
        if not detected:
            print(f"[WARNING] Object '{obj_name}' not detected within {timeout}s — aborting task")
            try:
                _bridge.notify("/api/human-step-timeout",
                               {"condition": "object", "value": obj_name})
            except Exception:
                pass
            _abort_task(f"object '{obj_name}' not detected within {timeout}s")
        else:
            print(f"[CONDITION] Object '{obj_name}' detected!")
        return detected

    elif block_type == EventsItems.TIMER.value:
        seconds = int(condition_block.get("fields", {}).get("SECONDS", 5))
        print(f"[CONDITION] Timer: waiting {seconds} seconds...")
        _interruptible_sleep(seconds)
        print("[CONDITION] Timer expired → condition fulfilled")
        return True

    elif block_type == EventsItems.VOICE.value:
        # Voice recognition happens in the operator's browser (Web Speech API);
        # the matched word is cached in-process by vision_live.process_voice_command.
        # No ROS bridge involved — poll the Django-side cache directly.
        from backend.functions.vision_live import get_latest_voice

        word = condition_block.get("fields", {}).get("VOICE_WORD", "YES")
        print(f"[CONDITION] Waiting for voice command: {word} (timeout {timeout}s)...")
        deadline = time.monotonic() + timeout
        detected = False
        while time.monotonic() < deadline:
            if SIMULATION_STOP_EVENT.is_set():
                break
            if get_latest_voice() == word:
                detected = True
                break
            _interruptible_sleep(0.5)
        if not detected:
            print(f"[WARNING] Voice command '{word}' not heard within {timeout}s — continuing")
            try:
                _bridge.notify("/api/human-step-timeout",
                               {"condition": "voice", "value": word})
            except Exception:
                pass
        else:
            print(f"[CONDITION] Voice command '{word}' heard!")
        return detected

    # Fallback: sensor_signal, touch_detect, human_feedback → treat as fulfilled
    return _log_condition(condition_block, simulate_event=True)


def _move_to_scan_pose():
    """Move robot to SCAN_POSE if not already there, then settle for detection."""
    current_joints, _ = get_current_state()
    max_delta = max(abs(t - s) for t, s in zip(SCAN_POSE, current_joints))
    if max_delta > 2.0:  # degrees threshold — skip move if already in scan pose
        print(f"[SCAN] Moving to scan pose {SCAN_POSE}")
        smooth_move(SCAN_POSE, ROS_OPEN_GRIPPER)
        _interruptible_sleep(0.8)  # camera settle before detection
    else:
        print("[SCAN] Already at scan pose — skipping move")


def _condition_contains_find(block: dict) -> bool:
    """Return True if the condition tree contains any find_object_block."""
    if block is None:
        return False
    if block.get("type") == EventsItems.FIND.value:
        return True
    inputs = block.get("inputs", {})
    return any(
        _condition_contains_find(inputs.get(k, {}).get("block"))
        for k in ("A", "B", "BOOL")
    )


def _eval_condition_tree(block: dict, simulate_event: bool) -> bool:
    """Evaluate a condition block tree, handling AND/OR/NOT recursively.

    AND/OR/NOT blocks route to child branches; leaf blocks fall through to
    _resolve_condition (gesture, find_object, timer, etc.).
    """
    if block is None:
        return True

    btype = block.get("type", "")
    inputs = block.get("inputs", {})

    if btype == "logic_and_block":
        a = _eval_condition_tree(inputs.get("A", {}).get("block"), simulate_event)
        b = _eval_condition_tree(inputs.get("B", {}).get("block"), simulate_event)
        return a and b

    if btype == "logic_or_block":
        a = _eval_condition_tree(inputs.get("A", {}).get("block"), simulate_event)
        b = _eval_condition_tree(inputs.get("B", {}).get("block"), simulate_event)
        return a or b

    if btype == "logic_not_block":
        inner = _eval_condition_tree(inputs.get("BOOL", {}).get("block"), simulate_event)
        return not inner

    # Leaf block: gesture, find_object, timer, etc.
    return _resolve_condition(block, simulate_event)


def _resolve_condition(condition_block: dict, simulate_event: bool) -> bool:
    """Route to real wait or simulated log based on simulate_event flag."""
    if not simulate_event:
        return _wait_for_condition(condition_block)
    return _log_condition(condition_block, simulate_event=True)


# ─────────────────────────────────────────────────────────────────────────────
# MAIN RECURSIVE PARSER
# ─────────────────────────────────────────────────────────────────────────────

# Leaf action blocks whose execution is mirrored to the frontend as a live
# "block_step" highlight (start before the handler, end after it). Containers
# (repeat/when) are intentionally excluded — only the running action glows.
HIGHLIGHTABLE_BLOCKS = {
    StepsItems.PICK.value, StepsItems.PLACE.value, StepsItems.PROCESSING.value,
    StepsItems.MOVE_TO.value, StepsItems.GRIPPER.value, StepsItems.OPEN_GRIPPER.value,
    StepsItems.CLOSE_GRIPPER.value, StepsItems.WAIT.value,
    StepsItems.HUMAN_ACTION.value, StepsItems.NOTIFY_ACTION.value,
}


def _notify_block_step(block_id, block_type, phase):
    """Fire-and-forget block-execution highlight event (non-fatal)."""
    try:
        _bridge.notify("/api/block-step", {
            "kind": "block",
            "blockId": block_id,
            "blockType": block_type,
            "phase": phase,
        })
    except Exception:
        pass


def simulation_recursive_blockly_parser(
    code: dict,
    objectsOfUser: List[Object],
    actionsOfUser: List[Action],
    locationsOfUser: List[Location],
    simulate_event: bool,
    inside_conditional: bool = False,
):
    """Recursive parser: Blockly JSON → Gazebo/ROS2 simulation commands.

    Supported blocks
    ────────────────
    Logic    : repeat_block, repeat_until_block,
               when_block, when_otherwise_block
    Robot    : pick_block, place_block, processing_block,
               move_to_block, gripper_block
    Human    : human_action_block, notify_action_block
    Macro    : macro_task_block
    """
    if SIMULATION_STOP_EVENT.is_set():
        print("[SIMULATOR] Stop requested — aborting simulation")
        return

    try:
        block_type = code["type"]

        # ── Inline helpers ────────────────────────────────────────────────────

        def _next():
            """Continue execution with the next chained block."""
            if SIMULATION_STOP_EVENT.is_set():
                print("[SIMULATOR] Stop requested — skipping next block")
                return
            if code.get("next") is not None:
                simulation_recursive_blockly_parser(
                    code["next"]["block"],
                    objectsOfUser, actionsOfUser, locationsOfUser,
                    simulate_event, inside_conditional,
                )

        def _recurse(input_name: str):
            """Recurse into a named statement-input block."""
            blk = code.get("inputs", {}).get(input_name, {}).get("block")
            if blk:
                simulation_recursive_blockly_parser(
                    blk, objectsOfUser, actionsOfUser, locationsOfUser,
                    simulate_event, inside_conditional=True,
                )

        def _safe_block_data(input_name: str, label: str):
            """Parse a value-input block's JSON ``data`` payload.

            Returns the decoded dict, or ``None`` if the input is missing or the
            JSON is malformed. Callers should skip the block (and continue the
            chain via ``_next()``) when this returns ``None`` so a single bad
            block does not abort the rest of the program.
            """
            try:
                return loads(code["inputs"][input_name]["block"]["data"])
            except (KeyError, TypeError, ValueError) as exc:
                print(f"[ERROR] {label}: malformed/missing block data, skipping: {exc}")
                return None

        # ══════════════════════════════════════════════════════════════════════
        # LOGIC / CONTROL FLOW
        # ══════════════════════════════════════════════════════════════════════

        # ── Block handlers ────────────────────────────────────────────────────
        # Each handler runs one block type and is responsible for continuing the
        # chain via _next(). They are dispatched through BLOCK_HANDLERS below
        # (a registry keyed by block type) instead of a long if/elif chain.

        def _h_repeat():
            times = int(code["fields"]["times"])
            print(f"[LOGIC] Repeat x{times}")
            for i in range(times):
                if SIMULATION_STOP_EVENT.is_set():
                    break
                print(f"[LOGIC]   iteration {i + 1}/{times}")
                _recurse("DO")
                delete_spawned_object_and_place()
            _interruptible_sleep(3)
            _next()

        def _h_repeat_until():
            print(f"[LOGIC] Repeat-Until (max {MAX_LOOP_ITERATIONS} iterations)")
            condition_block = code.get("inputs", {}).get("CONDITION", {}).get("block")
            _fulfilled = False
            for i in range(MAX_LOOP_ITERATIONS):
                if SIMULATION_STOP_EVENT.is_set():
                    break
                print(f"[LOGIC]   repeat-until iteration {i + 1}/{MAX_LOOP_ITERATIONS}")
                _recurse("DO")
                if condition_block:
                    if _condition_contains_find(condition_block):
                        _move_to_scan_pose()
                    _fulfilled = _eval_condition_tree(condition_block, simulate_event)
                else:
                    _fulfilled = True
                if _fulfilled:
                    print("[LOGIC] Repeat-Until: condition met, exiting loop")
                    break
                delete_spawned_object_and_place()
            if not _fulfilled and not SIMULATION_STOP_EVENT.is_set():
                print(f"[WARNING] Repeat-Until: cap ({MAX_LOOP_ITERATIONS}) reached, condition never met")
                try:
                    _bridge.notify(
                        "/api/human-step-timeout",
                        {"condition": "repeat_until", "value": "cap_reached"},
                    )
                except Exception:
                    pass
            _interruptible_sleep(3)
            _next()

        def _h_when():
            condition_block = code["inputs"]["WHEN"]["block"]
            if _condition_contains_find(condition_block):
                _move_to_scan_pose()
            fulfilled = _eval_condition_tree(condition_block, simulate_event)
            if fulfilled:
                _recurse("DO")
                _interruptible_sleep(3)
            _next()

        def _h_when_otherwise():
            condition_block = code["inputs"]["WHEN"]["block"]
            if _condition_contains_find(condition_block):
                _move_to_scan_pose()
            fulfilled = _eval_condition_tree(condition_block, simulate_event)
            if fulfilled:
                _recurse("DO")
            else:
                _recurse("OTHERWISE")
            _interruptible_sleep(3)
            _next()

        # ══════════════════════════════════════════════════════════════════════
        # HUMAN ACTIONS
        # ══════════════════════════════════════════════════════════════════════

        def _h_human_action():
            task_desc = code.get("fields", {}).get("TASK_DESC", "No description")
            print(f"\n[!] HUMAN ACTION REQUIRED: {task_desc}")
            confirm_event = code.get("inputs", {}).get("CONFIRM_EVENT", {}).get("block")
            step_start_payload = {"description": task_desc, "timeout": 60}
            if confirm_event:
                ev_type = confirm_event.get("type", "")
                if ev_type == EventsItems.GESTURE.value:
                    step_start_payload["condition"] = "gesture"
                    step_start_payload["value"] = confirm_event.get("fields", {}).get("GESTURE_TYPE", "THUMBS_UP")
                elif ev_type == EventsItems.VOICE.value:
                    step_start_payload["condition"] = "voice"
                    step_start_payload["value"] = confirm_event.get("fields", {}).get("VOICE_WORD", "YES")
                elif ev_type == EventsItems.FIND.value:
                    try:
                        obj_data = loads(confirm_event["inputs"]["OBJECT"]["block"]["data"])
                        step_start_payload["condition"] = "object"
                        step_start_payload["value"] = obj_data.get("name", "")
                    except Exception:
                        pass
            try:
                _bridge.notify("/api/human-step-start", step_start_payload)
            except Exception:
                pass
            if confirm_event:
                if _condition_contains_find(confirm_event):
                    _move_to_scan_pose()
                _eval_condition_tree(confirm_event, simulate_event)
            try:
                _bridge.notify("/api/human-step-complete")
            except Exception:
                pass
            _next()

        def _h_notify_action():
            task_desc = code.get("fields", {}).get("TASK_DESC", "No description")
            print(f"\n[NOTIFY] Operator message: {task_desc}")
            try:
                _bridge.notify("/api/notify", {"description": task_desc})
            except Exception:
                pass
            _next()

        # ══════════════════════════════════════════════════════════════════════
        # ROBOT STEP ACTIONS
        # ══════════════════════════════════════════════════════════════════════

        def _h_pick():
            object_data = _safe_block_data("OBJECT", "PICK")
            if object_data is None:
                _next()
                return
            if _spawned_in_world:
                # A prior pick/place in this run left an object spawned — spawning
                # under the fixed entity name "object" would collide, and the
                # following place would teleport the stale object instead of the
                # new one. Clean up before spawning the next pick.
                print("[SIMULATOR] Previous object still in world — cleaning up before new pick")
                delete_spawned_object_and_place()
            obj = objectsOfUser.filter(id=object_data["id"]).first()
            sdf_name = obj.name if obj else object_data.get("name", "unknown")
            safe_sdf_name = sdf_name.replace(" ", "_").lower()
            print(f"[ROBOT] PICK: {sdf_name}")
            _, _, obj_min_z = get_sdf_dimensions(safe_sdf_name)
            z_rest = TABLE_TOP_Z_ABS - obj_min_z
            cmd = (
                'gz service -s /world/worldCobotta/create '
                '--reqtype gz.msgs.EntityFactory --reptype gz.msgs.Boolean '
                '--timeout 5000 --req \'name: "object"; '
                f'sdf_filename: "{os.path.join(BASE_DIR, "ros2_ws", "Cobotta", "objects", safe_sdf_name, "model.sdf")}"; '
                f'pose: {{position: {{x: {OBJECT_SPAWN_X}, y: {OBJECT_SPAWN_Y}, z: {z_rest}}}, '
                'orientation: {x: 0, y: 0, z: 0, w: 1}}\''
            )
            # Pick aims at the KNOWN spawn XY (deterministic) — the deterministic
            # hold below keeps the object there, so no physics-settle read is needed.
            pick_x_rel = OBJECT_SPAWN_X - ROBOT_BASE_X
            pick_y_rel = OBJECT_SPAWN_Y - ROBOT_BASE_Y
            spawn_ok = launch_wsl_ros_command(cmd, expect_reply_true=True)
            if not spawn_ok:
                print(f"[SIMULATOR] WARNING: object spawn failed for '{sdf_name}' — pick will run but attach skipped")
            else:
                print(f"[SIMULATOR] Spawn OK: 'object' ({sdf_name}) at z={z_rest:.4f} (min_z={obj_min_z:.4f})")
                _spawned_in_world.add(sdf_name)
                # Detach-FIRST: clear the pending DetachableJoint auto-weld before any
                # hold/read, so the object never free-falls from the arm home pose.
                print("[GRASP] Post-spawn detach: neutralizing pending auto-attach")
                detach_object_from_gripper()
                _interruptible_sleep(0.1)
                detach_object_from_gripper()
                # Deterministic hold: assert the object upright at its known rest pose
                # (kills the home-drop + tip of tall/thin objects). No polling settle.
                # GATE (mirror the pre-attach snap): a failed hold breaks determinism,
                # so abort this pick rather than grasping an unheld/unstable object.
                if set_object_world_pose(OBJECT_SPAWN_X, OBJECT_SPAWN_Y, z_rest, yaw=0.0):
                    print(f"[GRASP] hold confirmed: upright at rest "
                          f"({OBJECT_SPAWN_X},{OBJECT_SPAWN_Y},z={z_rest:.4f})")
                else:
                    print("[GRASP] ABORT: post-spawn hold failed — skipping pick")
                    _next()
                    return
                _interruptible_sleep(0.3)
            simulation_recursive_blockly_parser.last_picked_object = sdf_name
            simulate_ros_pick(obj, sdf_name, do_attach=spawn_ok,
                              pick_x_rel=pick_x_rel, pick_y_rel=pick_y_rel,
                              obj_min_z=obj_min_z)
            _next()

        def _h_place():
            location_data = _safe_block_data("LOCATION", "PLACE")
            if location_data is None:
                _next()
                return
            location = locationsOfUser.filter(id=location_data["id"]).first()
            sdf_name = location.name if location else location_data.get("name", "unknown")
            safe_loc_sdf_name = sdf_name.replace(" ", "_").lower()
            print(f"[ROBOT] PLACE: {sdf_name}")
            loc_cmd = (
                'gz service -s /world/worldCobotta/create '
                '--reqtype gz.msgs.EntityFactory --reptype gz.msgs.Boolean '
                '--timeout 5000 --req \'name: "location"; '
                f'sdf_filename: "{os.path.join(BASE_DIR, "ros2_ws", "Cobotta", "locations", safe_loc_sdf_name, "model.sdf")}"; '
                f'pose: {{position: {{x: {LOCATION_SPAWN_X}, y: {LOCATION_SPAWN_Y}, z: {TABLE_TOP_Z_ABS}}}, '
                'orientation: {x: 0, y: 0, z: 0.7071, w: 0.7071}}\''
            )
            if not launch_wsl_ros_command(loc_cmd, expect_reply_true=True):
                print(f"[SIMULATOR] WARNING: location spawn failed for '{sdf_name}' — place may fail")
            picked_obj_name = getattr(simulation_recursive_blockly_parser, "last_picked_object", "flask")
            simulate_ros_place(picked_obj_name, objectsOfUser, sdf_name)
            _interruptible_sleep(1)
            _next()

        def _h_processing():
            action_data = _safe_block_data("ACTION", "PROCESSING")
            if action_data is None:
                _next()
                return
            action = actionsOfUser.filter(id=action_data["id"]).first()
            action_name = action.name if action else action_data.get("name", "unknown")
            print(f"[ROBOT] PROCESSING action: {action_name}")
            if action and action.points:
                try:
                    action_points = loads(action.points).get("points", [])
                    simulate_ros_action(action_points)
                except Exception:
                    pass
            _next()

        def _h_move_to():
            location_data = _safe_block_data("LOCATION", "MOVE_TO")
            if location_data is None:
                _next()
                return
            location_name = location_data.get("name", "Unknown")
            motion_type = code.get("fields", {}).get("MOTION_TYPE", "LINEAR")
            print(f"[ROBOT] MOVE_TO ({motion_type}) → {location_name}")

            # Hybrid approach: prefer joint positions stored in Location.position
            # (DB), fall back to a hardcoded safe intermediate position.
            location = locationsOfUser.filter(id=location_data.get("id")).first()
            moved = False
            if location and location.position:
                pos = location.position if isinstance(location.position, dict) else {}
                j_keys = ["j1", "j2", "j3", "j4", "j5", "j6"]
                if all(k in pos for k in j_keys):
                    print(f"[ROBOT]   Using stored joint positions from DB for '{location_name}'")
                    target_q = [pos["j1"], pos["j2"], pos["j3"], pos["j4"], pos["j5"], pos["j6"]]
                    simulate_ros_move(
                        pos["j1"], pos["j2"], pos["j3"],
                        pos["j4"], pos["j5"], pos["j6"],
                        ROS_OPEN_GRIPPER,
                    )
                    _send_hw_target(target_q, ROS_OPEN_GRIPPER)
                    moved = True

            if not moved:
                print(f"[ROBOT]   No joint data in DB for '{location_name}' → using default intermediate position")
                simulate_ros_move(*SAFE_INTERMEDIATE_POSE, ROS_CLOSE_GRIPPER_WITH_OBJECT)
                _send_hw_target(list(SAFE_INTERMEDIATE_POSE), ROS_OPEN_GRIPPER)

            _interruptible_sleep(2)
            _next()

        def _h_gripper():
            state = code.get("fields", {}).get("GRIPPER_STATE", "CLOSE")
            if state == "OPEN":
                print("[ROBOT] Opening gripper")
                hand_value = ROS_OPEN_GRIPPER
            else:
                print("[ROBOT] Closing gripper")
                hand_value = ROS_CLOSE_GRIPPER_WITH_OBJECT
            # Send only the hand command, keeping arm at safe home (J3=90°)
            simulate_ros_move(0, 0, 90, 0, 0, 0, hand_value, joint_abs=True)
            _send_hw_target([], hand_value, hand_only=True)
            _interruptible_sleep(1)
            _next()

        def _h_open_gripper():
            print("[ROBOT] Opening gripper")
            simulate_ros_move(0, 0, 90, 0, 0, 0, ROS_OPEN_GRIPPER, joint_abs=True)
            _send_hw_target([], ROS_OPEN_GRIPPER, hand_only=True)
            _interruptible_sleep(1)
            _next()

        def _h_close_gripper():
            print("[ROBOT] Closing gripper")
            simulate_ros_move(0, 0, 90, 0, 0, 0, ROS_CLOSE_GRIPPER_WITH_OBJECT, joint_abs=True)
            _send_hw_target([], ROS_CLOSE_GRIPPER_WITH_OBJECT, hand_only=True)
            _interruptible_sleep(1)
            _next()

        def _h_wait():
            seconds = int(code.get("fields", {}).get("SECONDS", 1))
            print(f"[ROBOT] Wait {seconds}s (interruptible)")
            _interruptible_sleep(seconds)
            _next()

        # ══════════════════════════════════════════════════════════════════════
        # MACRO TASKS
        # ══════════════════════════════════════════════════════════════════════

        def _h_macro():
            try:
                macro_data = loads(code["data"])
            except (KeyError, TypeError, ValueError) as exc:
                print(f"[ERROR] MACRO: malformed/missing block data, skipping: {exc}")
                _next()
                return
            macro_id = macro_data["id"]
            macro_name = macro_data.get("name", str(macro_id))
            print(f"[MACRO] Starting macro: {macro_name}")
            macro_task = Task.objects.filter(id=macro_id).first()
            if macro_task and macro_task.code:
                simulation_recursive_blockly_parser(
                    loads(macro_task.code),
                    objectsOfUser, actionsOfUser, locationsOfUser,
                    simulate_event, inside_conditional,
                )
            else:
                print(f"[MACRO] WARNING: macro {macro_id} not found or has no code")
            print(f"[MACRO] Macro complete: {macro_name}")
            _next()

        def _h_when_start():
            print("[LOGIC] Start sequence")
            _next()

        # Registry: block type → handler. Replaces the former if/elif chain.
        BLOCK_HANDLERS = {
            LogicItems.REPEAT.value: _h_repeat,
            LogicItems.REPEAT_UNTIL.value: _h_repeat_until,
            LogicItems.WHEN.value: _h_when,
            LogicItems.WHEN_OTHERWISE.value: _h_when_otherwise,
            StepsItems.HUMAN_ACTION.value: _h_human_action,
            StepsItems.NOTIFY_ACTION.value: _h_notify_action,
            StepsItems.PICK.value: _h_pick,
            StepsItems.PLACE.value: _h_place,
            StepsItems.PROCESSING.value: _h_processing,
            StepsItems.MOVE_TO.value: _h_move_to,
            StepsItems.GRIPPER.value: _h_gripper,
            StepsItems.OPEN_GRIPPER.value: _h_open_gripper,
            StepsItems.CLOSE_GRIPPER.value: _h_close_gripper,
            StepsItems.WAIT.value: _h_wait,
            MacroItems.MACRO_TASK.value: _h_macro,
            "when_start": _h_when_start,
        }

        handler = BLOCK_HANDLERS.get(block_type)
        if handler is not None:
            block_id = code.get("id")
            emit_highlight = bool(block_id) and block_type in HIGHLIGHTABLE_BLOCKS
            if emit_highlight:
                _notify_block_step(block_id, block_type, "start")
            handler()
            if emit_highlight:
                _notify_block_step(block_id, block_type, "end")
        else:
            print(f"[WARNING] Block type unknown or ignored: {block_type}")

    except Exception as e:
        print(f"[ERROR] simulation_recursive_blockly_parser: {e}")


def simulate_task(request: HttpRequest) -> HttpResponse:
    global _TASK_ABORT_REASON, _HW_DRIVE_REQUESTED
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                task_id = data.get("id")
                simulate_event = data.get("simulateEvent")
                drive_hardware = bool(data.get("driveHardware", False))
                if drive_hardware and not DRIVE_HARDWARE:
                    return error_response(
                        "Hardware not armed on this server (DRIVE_HARDWARE unset) — run refused."
                    )

                if not _SIM_RUN_LOCK.acquire(blocking=False):
                    return error_response("A simulation is already running", status=409)
                try:
                    task = Task.objects.filter(id=task_id).filter(
                        Q(owner=request.user.id) | Q(shared=True)
                    ).first()
                    if task is None:
                        return error_response("Task not found or unauthorized")

                    objectsOfUser = Object.objects.filter(
                        Q(owner=request.user.id) | Q(shared=True)
                    )
                    actionsOfUser = Action.objects.filter(
                        Q(owner=request.user.id) | Q(shared=True)
                    )
                    locationsOfUser = Location.objects.filter(
                        Q(owner=request.user.id) | Q(shared=True)
                    )
                    if task.status != "published":
                        return error_response(
                            "Only a fully published task can be simulated. "
                            "Publish or discard the current draft first."
                        )

                    code = _resolve_runtime_workspace(task)
                    if code is None:
                        return error_response("No published workspace available")

                    SIMULATION_STOP_EVENT.clear()
                    _TASK_ABORT_REASON = None
                    _HW_DRIVE_REQUESTED = drive_hardware
                    _set_world_paused(False)
                    reset_simulation_world()

                    try:
                        if isinstance(code, list):
                            for block in code:
                                simulation_recursive_blockly_parser(
                                    block, objectsOfUser, actionsOfUser, locationsOfUser,
                                    simulate_event, inside_conditional=False,
                                )
                        else:
                            simulation_recursive_blockly_parser(
                                code, objectsOfUser, actionsOfUser, locationsOfUser,
                                simulate_event, inside_conditional=False,
                            )
                        if _TASK_ABORT_REASON:
                            return error_response(f"Task aborted: {_TASK_ABORT_REASON}")
                        return success_response()
                    finally:
                        _set_world_paused(True)
                finally:
                    _HW_DRIVE_REQUESTED = False
                    _SIM_RUN_LOCK.release()
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def stop_simulation(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.POST.value:
                SIMULATION_STOP_EVENT.set()
                _spawned_in_world.clear()
                _delete_placed_objects()
                try:
                    _bridge.stop()
                except Exception as e:
                    print(f"[SIMULATOR] Could not forward stop to Flask bridge: {e}")
                _set_world_paused(True)
                return success_response()
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def hardware_status(request: HttpRequest) -> HttpResponse:
    """Proxy for the Flask bridge's /api/health hardware block, plus whether
    this server is armed to drive hardware at all (DRIVE_HARDWARE env). Used
    by the frontend to show a "Hardware armed" badge before a Real robot run."""
    try:
        if request.user.is_authenticated:
            try:
                hardware = _bridge.get_health().get("hardware", {})
                return success_response({"armed": DRIVE_HARDWARE, "hardware": hardware})
            except Exception as e:
                return success_response({"armed": DRIVE_HARDWARE, "hardware": {}, "error": str(e)})
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))
