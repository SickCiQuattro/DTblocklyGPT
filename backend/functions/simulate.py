from backend.functions.task import _resolve_runtime_workspace
from backend.block_types import (
    WHEN_START,
    BooleanItems,
    LogicItems,
    StepsItems,
    EventsItems,
    MacroItems,
)
import re
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
import warnings
import ikpy.chain
import numpy as np
import threading
import requests.exceptions
from backend.functions.env_utils import get_bool_env
from backend.functions import study_log
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
    PLACE_Z_OFFSETS,
    PICK_RACK_PROFILE,
    RACK_RIM_H,
    RACK_SLOT_INNER_W,
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
# Refuse to satisfy a human-confirm condition by any route other than a real,
# observed operator action taken during the step. Off by default: the bypasses
# it disables exist so a developer without a camera can still run a task
# end-to-end. On, they become failures.
#
# Required for user-study sessions, where each bypass silently fabricates a
# successful confirmation that is indistinguishable in the recording from one
# the participant actually made:
#   - a dead vision bridge returns success for gesture and find_object (but
#     never for voice or button, so it biases two conditions out of four);
#   - an object already in frame, or already spawned in the Gazebo world,
#     satisfies find_object with no operator involvement at all.
STRICT_CONDITIONS = get_bool_env("STRICT_CONDITIONS")
MAX_LOOP_ITERATIONS = int(os.getenv("MAX_LOOP_ITERATIONS", "10"))
# How many of a ramp's IK waypoints reach the real arm, at most (Gazebo always
# gets the full path). Each waypoint sent to hardware is a discrete b-CAP PTP
# that decelerates to a full stop, so a straight dense ramp (10-15 points)
# played waypoint-by-waypoint reads as visibly stepped/jerky motion on the
# physical robot — confirmed on physical hardware 2026-07-29. This is a CAP,
# not a stride: a ramp of any length is thinned to at most this many hardware
# calls, so "2" always means 2 stops regardless of how dense the Gazebo path
# is (a stride would give a different stop count per ramp length — tried
# first, replaced after the same hardware session showed 2-6 stops depending
# on the segment instead of a consistent number). 1 = only the final point
# (smoothest, least path tracking); raise toward the ramp's full length if a
# rack/table clearance needs tighter tracking. The final waypoint of every
# ramp is always included regardless (see _send_hw_path) — it is the one
# FK/precision-critical point of the segment.
HW_MAX_WAYPOINTS_PER_SEGMENT = int(os.getenv("HW_MAX_WAYPOINTS_PER_SEGMENT", "2"))

# Gazebo's controllers run on sim time (use_sim_time: true in controllers.yaml)
# while this process sleeps in wall time. The two only agree at real-time
# factor 1.0 — with software rendering (kms_swrast, i.e. any machine without
# working GPU acceleration) the RTF drops well below that, so sleeping a
# trajectory's nominal duration returns while the twin is still animating. The
# parser then starts the next block against an arm that has not arrived:
# confirmed live 2026-07-30 as an operator-confirm prompt appearing while the
# robot was visibly still moving through a pick. After the nominal sleep, the
# move helpers now poll the twin's real joint feed until it reaches the
# commanded pose.
SIM_ARRIVAL_TOL_DEG = float(os.getenv("SIM_ARRIVAL_TOL_DEG", "1.5"))
# Cap on the EXTRA wait beyond the nominal duration, so a stalled/absent joint
# feed can never hang a run.
SIM_ARRIVAL_MAX_EXTRA_S = float(os.getenv("SIM_ARRIVAL_MAX_EXTRA_S", "10.0"))
# Secondary exit: per-joint movement between consecutive polls below this, for
# this many samples in a row, means the arm has stopped — done waiting whether
# or not it landed inside SIM_ARRIVAL_TOL_DEG.
SIM_ARRIVAL_STILL_TOL_DEG = float(os.getenv("SIM_ARRIVAL_STILL_TOL_DEG", "0.05"))
SIM_ARRIVAL_STILL_SAMPLES = int(os.getenv("SIM_ARRIVAL_STILL_SAMPLES", "5"))
# Macro-call recursion cap. No DAG cycle detection exists at publish time,
# so a macro cycle (A calls B calls A) is creatable from the UI today, and
# without this cap it would recurse until Python's own RecursionError, which
# the parser's blanket except swallows silently, truncating the task with
# only a log line. This turns that into an explicit, reported _abort_task
# instead.
MAX_MACRO_DEPTH = int(os.getenv("MAX_MACRO_DEPTH", "10"))

# Tolerance on the gesture stale-replay check (_wait_for_condition): the
# bridge reports how long ago (in seconds) a gesture was seen, and this
# process reconstructs "reported_at" from its own clock read taken just
# before the request — two different clock reads of the same monotonic
# clock, with real (if normally sub-millisecond) skew between them from
# request/response overhead. A hard `>=` with zero tolerance occasionally
# misclassified a gesture reported right at the start of the wait as stale
# by a few milliseconds (confirmed flaky in test_gesture_recognition.py
# under load, 2026-07-29). Kept well under 100ms on purpose — real stale
# replays this exists to reject are seconds old, from a previous run/step,
# so there is a wide safety margin without weakening that check.
GESTURE_FRESHNESS_SLOP_S = 0.02

# Per-request switch, set by simulate_task() from the "driveHardware" body key.
# NOTE: single-process runserver only (same constraint as SIMULATION_STOP_EVENT
# above) — a multi-process WSGI deployment would need shared state. Combined
# with the _SIM_RUN_LOCK busy-guard in simulate_task(), only one run touches
# this flag at a time, so the single global is safe under runserver's default
# threading.
_HW_DRIVE_REQUESTED: bool = False

# Owner of the task currently running, set by simulate_task() for the
# duration of the run (same single-run-lock safety as _HW_DRIVE_REQUESTED
# above). _h_macro() needs it to scope a nested macro lookup to
# owner-or-shared — without it, a macro_task_block with an arbitrary id
# could execute another user's private task (the same visibility rule
# simulate_task() itself already applies to the top-level task).
_RUN_OWNER_ID: int | None = None


def _hw_drive_active() -> bool:
    """True only when the server is armed (DRIVE_HARDWARE) AND the current
    request explicitly asked to drive hardware (driveHardware: true in the
    /api/task/simulate/ body). Neither alone is enough — a "Simulation" run
    must never move the real arm just because the server happens to be armed
    for a "Real robot" session elsewhere."""
    return DRIVE_HARDWARE and _HW_DRIVE_REQUESTED


def convert_hand_gazebo_cobotta(gazebo_hand_value):
    """Convert a Gazebo gripper joint value (metres, per finger, joint_left/
    joint_right) to the Cobotta hand aperture scale (0-30). Must stay the exact
    algebraic inverse of convert_hand_cobotta_gazebo in cobotta_utils.py (ROS
    side).

    The Gazebo range is [-0.015, 0.0], from Cobotta.sdf.template — the model
    Gazebo actually loads for physics. Do NOT re-derive it from the
    joint_left/joint_right <limit> in cobotta_ik.urdf ([0, 0.01]): that file
    only feeds robot_description/ikpy and its gripper limits do not describe
    this joint. 2026-07-30: both conversions were rescaled to that URDF range
    and the gripper stopped closing in the twin entirely (every command
    clamped to the same end of the real range). Reverted."""
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

# ── Run generations ──────────────────────────────────────────────────────────
#
# Teardown work outlives the run that asked for it. `_set_world_paused(True)`
# and the placed-object sweep are `gz` subprocesses with their own latency, and
# they are issued from TWO threads: the Stop request, and the run thread as it
# unwinds. Stop a run and start another one a second later and those calls can
# land after the new run has already begun.
#
# The worst of them is silent: Stop's pause arriving after the new run's
# unpause leaves the world PAUSED for the whole new run. The arm never moves
# and nothing says why — reported 2026-09-03 as "l'ho riavviata dopo 1-2s e ci
# sono stati dei problemi".
#
# So teardown is not ordered, it is made irrelevant once superseded. Every run
# and every Stop takes a generation; anything that could land late checks
# whether its generation is still the current one first. Same shape as the
# epoch guard in useWebcamVision, and for the same reason: with two threads and
# subprocess latency between them, ordering is a wish and a generation counter
# is a fact.
_RUN_GENERATION = 0
_RUN_GEN_LOCK = threading.Lock()


def _begin_run_generation() -> int:
    """Claim a generation. Everything issued under an older one is now dead."""
    global _RUN_GENERATION
    with _RUN_GEN_LOCK:
        _RUN_GENERATION += 1
        return _RUN_GENERATION


def _generation_is_current(generation: int) -> bool:
    with _RUN_GEN_LOCK:
        return generation == _RUN_GENERATION


# The destination model currently spawned as "location", or None. Lets a run
# that places repeatedly into the same container leave it standing instead of
# deleting and recreating it before every place.
_spawned_location_name = None

# Tracks Gazebo model names spawned in the current simulation run.
# Used by find_object bypass: if object is in world, skip vision polling.
# Cleared on reset_simulation_world(), delete_spawned_object_and_place(), and STOP.
_spawned_in_world: set = set()

# Registry of persisted placed-object entity names (e.g. "placed_3"), spawned
# by _persist_placed_object so a placed item survives the next pick's cleanup
# of the reusable "object" entity. _placed_seq is monotonic and never reset
# mid-run, so a failed sweep can't cause a name collision on next spawn.
# (entity name, destination it was placed in). The destination is recorded
# because a place into a DIFFERENT container has to take the previous
# container's contents with it: the placed objects are independent top-level
# models, not children of the "location" entity, so removing that container
# left them resting on nothing and they fell across the bench.
_placed_in_world: list = []
_placed_seq: int = 0
# Guards _placed_in_world against the run thread (appending via
# _persist_placed_object) and stop_simulation() (clearing it) racing on the
# same list with no synchronization — a plain list append during a
# concurrent reassignment can silently drop an entry, leaking that object in
# Gazebo past STOP. Deliberately its own lock, not _SIM_RUN_LOCK:
# Stop must be able to interrupt a run that's still holding _SIM_RUN_LOCK.
_PLACED_LOCK = threading.Lock()

# Set by _wait_for_condition when it resolves a condition WITHOUT the operator
# actually satisfying it (camera unreachable, object already in frame/world).
# Read by _h_human_action so the study log can tell a fabricated confirmation
# apart from a real one: the two are indistinguishable in the recording, and a
# researcher reading the JSONL afterwards has no other way to spot a session
# that ran with the vision stack down. Cleared at every step entry.
_LAST_CONDITION_BYPASS: str | None = None


def _mark_condition_bypass(reason: str) -> None:
    global _LAST_CONDITION_BYPASS
    _LAST_CONDITION_BYPASS = reason


def _take_condition_bypass() -> str | None:
    """Read and clear the bypass marker for the step that just finished."""
    global _LAST_CONDITION_BYPASS
    reason, _LAST_CONDITION_BYPASS = _LAST_CONDITION_BYPASS, None
    return reason


def _abort_task(reason: str, detail: str | None = None):
    """Hard-abort the running task: stop the parser loop, stop Gazebo AND the real
    arm (so the twin can't keep moving while the reason for aborting is exactly
    that the two diverged), and tell the frontend why.

    `reason` is shown to the operator verbatim — plain language (what
    happened + what to do next), no engineering jargon. It becomes the
    persistent error banner in the robot panel and the
    HTTP error message. `detail`, when given, is the technical version
    (function names, coordinates, exception text) and stays in the server
    log only — never sent to the frontend.

    Idempotent: only the first reason is kept if called more than once.
    """
    global _TASK_ABORT_REASON
    # An operator Stop is already in progress and nothing has claimed a
    # failure: whatever is calling here is FALLOUT from that Stop, not a fault.
    # Stopping mid-motion means the arm does not reach where it was told, the
    # object does not rise with it, and the twin diverges from its target —
    # every gate in this file then fires, and the operator was shown a
    # technical failure for doing exactly what the Stop button is for.
    # Reported 2026-09-03: "giustamente il braccio non è arrivato alla
    # provetta perchè ho terminato simulazione, ma proprio per questo non
    # dovrebbe uscirmi un errore".
    #
    # A genuine fault that fires FIRST still wins, because the event is clear
    # at that moment (simulate_task clears it at the start of every run): it
    # takes the branch below, claims the reason, and sets the event itself.
    # Everything that fires afterwards — its own fallout, or a Stop the
    # operator presses in reaction — is suppressed here, which is also the
    # idempotency the docstring promises.
    #
    # One condition, not two. Checking `_TASK_ABORT_REASON is None` as well
    # reads like it guards something, and does not: whenever the event is set
    # a reason is either already claimed (so the call is redundant) or the
    # Stop came from the operator (so the call is fallout). Both are skipped.
    if SIMULATION_STOP_EVENT.is_set():
        print(f"[ABORT] suppressed (run already stopping): {detail or reason}")
        return
    is_first_call = _TASK_ABORT_REASON is None
    if is_first_call:
        _TASK_ABORT_REASON = reason
    SIMULATION_STOP_EVENT.set()
    try:
        _bridge.stop()
    except Exception as e:
        logger.error("abort_bridge_stop_failed", extra={"reason": reason, "error": str(e)})
        if is_first_call:
            # The operator needs to know the soft-stop itself didn't land —
            # the arm may still be moving.
            _TASK_ABORT_REASON += " (also: could not confirm the robot stopped — check it manually)"
    try:
        _bridge.notify("/api/notify", {"description": reason, "status": "error"})
    except Exception as e:
        logger.warning("abort_notify_failed", extra={"error": str(e)})
    print(f"[ABORT] {reason}" + (f" — {detail}" if detail else ""))


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
        # from_urdf_file builds its own default active_links_mask (all links
        # active) before we replace it below, so it warns about the fixed
        # base/hand links here even though COBOTTA_CHAIN never uses that mask.
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=UserWarning, module="ikpy.chain")
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
        # _safe_gz_entity_name rejects anything but [a-z0-9_] — besides
        # preventing shell injection, that also blocks '..'/'/' path
        # traversal through this join, which a plain .replace(" ", "_")
        # would not.
        safe_name = _safe_gz_entity_name(sdf_name) or ""
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
    height band used to fail non-monotonically on the physical arm.

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
            # joint6 is NOT taken from the seed: orientation_mode="Z" below only
            # constrains the approach vector, leaving wrist roll (joint6) a free
            # DOF that ikpy's local solver just holds near its seed value — a
            # seeded joint6 silently overrides grasp_yaw and the arm never
            # actually rotates, even though the caller's grasp_yaw is logged
            # and used elsewhere (weld orientation, etc.), because the seed
            # was closer to 0 than to the requested yaw.
            seed_map = {
                'joint1': math.radians(seed[0]),
                'joint2': math.radians(seed[1]),
                'joint3': math.radians(seed[2]),
                'joint4': math.radians(seed[3]),
                'joint5': math.radians(seed[4]),
                'joint6': grasp_yaw,
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
    safe_name = _safe_gz_entity_name(sdf_name) or ""
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


def rack_lift_for_width(width_m: float) -> float:
    """How far above the table an object of this width rests at the rack.

    0.0 for anything that fits in a rack slot. For anything wider — the
    medicine bottle at 23mm against a 20.63mm slot — it's the rack's rim
    height: it can't go *in* a hole, so it sits *on top of* the rack, which is
    what the operator does with it on the real cell. Since 2026-07-30 the pick
    rack is a static model in worldCobotta.sdf, so this isn't cosmetic: an
    object placed at slot coordinates without this lift is spawned inside the
    rack walls and gets flung out by the physics engine on the first tick.

    Applied to all three heights that must agree, or the twin lies: where the
    object is spawned, where the gripper descends to grasp it, and where the
    pick snap teleports it.
    """
    return 0.0 if width_m <= RACK_SLOT_INNER_W else RACK_RIM_H


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
    z_pick = (PICK_Z_REF_OFFSET + model.grasp_center_offset + PICK_Z_FINE_TUNE
              + rack_lift_for_width(model.graspable_width))
    hand_close = int(min(30, max(0, round(model.graspable_width * 1000.0 - GRIPPER_GRIP_CLEARANCE_MM))))
    return PickPlan(
        spawn_pose=(pick_x_rel, pick_y_rel), x_rel=pick_x_rel, y_rel=pick_y_rel,
        z_pick=z_pick, tool_yaw=model.tool_yaw, hand_close=hand_close,
        grasp_center_offset=model.grasp_center_offset,
        feasible=True, reason=model.reason, planning_notes=notes)


def resolve_location_metrics(sdf_name: str) -> float:
    # Fallback heights (m), one per catalog location (seed_library.py
    # LOCATIONS). Every one of them is now built from primitives, so
    # get_sdf_dimensions answers for all four and none of these is reached in
    # practice — they stay as a backstop for a location folder whose SDF has
    # no usable collision geometry.
    #
    # The pot/pulvis/divider/pillbox entries that used to sit here described
    # model folders that no DB row pointed at; the folders went in the same
    # sweep, and a fallback height for a location that cannot be selected is
    # a lookup nothing can perform.
    location_heights = {
        "cup": 0.12,
        "tube_rack": 0.045,
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
        safe_name = _safe_gz_entity_name(sdf_name) or ""
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


def resolve_place_z(location_name: str, height_m: float) -> float:
    """Compute the place-descent target Z (robot-frame) for an object of
    `height_m` at `location_name` — the exact formula simulate_ros_place uses,
    factored out so testing/calibrate_rack.py's `goto-place` measures the
    same Z a real place actually targets instead of a separately-derived
    approximation. The two diverged before this: calibrate_rack.py computed
    a flat `PICK_Z_REF_OFFSET + loc_height + 0.02` hover height with no
    container detection and no object-height-dependent grip offset, so an
    operator's hover-height measurement was not the height a real place
    would descend to (found 2026-07-29 after a hardware place mismatch).
    """
    safe_loc_name = location_name.replace(" ", "_").lower()
    loc_height = resolve_location_metrics(location_name)
    _, floor_height, is_container = get_location_profile(safe_loc_name)

    if height_m > 0.04:
        z_grip = max(height_m / 2.0, height_m - 0.03)
    else:
        z_grip = height_m / 2.0

    # Per-location release height (calibration.PLACE_Z_OFFSETS), applied to
    # both branches: how high to let go at a given location is a property of
    # that location, not of how its base height happened to be derived.
    extra = PLACE_Z_OFFSETS.get(safe_loc_name, 0.0)

    if is_container and floor_height is not None:
        return PICK_Z_REF_OFFSET + floor_height + 0.003 + z_grip + extra
    return PICK_Z_REF_OFFSET + loc_height + 0.02 + z_grip + extra


# All block type identifiers: shared source of truth

# Outer bound on every `gz`/bash subprocess call — the CLI commands already
# self-bound via their own `--timeout`/`-d` flags (3-5s), so this is a hard
# backstop for a genuinely hung process, not the normal-path latency. Without
# it a stuck subprocess blocks the request thread AND _SIM_RUN_LOCK forever,
# so no later run can ever start.
_SHELL_CMD_TIMEOUT_S = 8

# Object/location names come from DB tables the operator can edit and are
# interpolated, after normalization, straight into a `bash -c "gz ... --req
# '...name: \"{name}\"...'"` string. Restricting the normalized name to this
# charset (no quotes, `;`, `$()`, whitespace) means it cannot break out of
# the surrounding shell/proto-text quoting — this is the actual fix, not
# shlex.quote(): the vulnerable string is data nested inside an already-quoted
# argument, not a standalone shell token, so shell-quoting it doesn't apply
# here the way it would for a bare argv element.
_SAFE_GZ_NAME_RE = re.compile(r"^[a-z0-9_]+$")


def _safe_gz_entity_name(name: str) -> str | None:
    """Normalize a DB object/location name into a Gazebo entity/SDF-folder
    name, or None if it contains anything unsafe to interpolate into a shell
    command. Callers must abort the task on None, not fall back to the
    unsanitized name."""
    safe = (name or "").replace(" ", "_").lower()
    return safe if _SAFE_GZ_NAME_RE.match(safe) else None


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
                timeout=_SHELL_CMD_TIMEOUT_S,
            )
        elif platform.system() == "Linux":
            result = subprocess.run(
                ["bash", "-c", command],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=_SHELL_CMD_TIMEOUT_S,
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
    except subprocess.TimeoutExpired:
        print(f"[SIMULATOR] launch_wsl_ros_command timed out after {_SHELL_CMD_TIMEOUT_S}s")
        return False
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
                timeout=_SHELL_CMD_TIMEOUT_S,
            )
        elif platform.system() == "Linux":
            result = subprocess.run(
                ["bash", "-c", command],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=_SHELL_CMD_TIMEOUT_S,
            )
        else:
            print("[SIMULATOR] Unsupported OS for _shell_output")
            return None
        return result.stdout.decode(errors="replace")
    except subprocess.TimeoutExpired:
        print(f"[SIMULATOR] _shell_output timed out after {_SHELL_CMD_TIMEOUT_S}s")
        return None
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
) -> bool:
    """Returns True on success. Every caller must check this before sending
    the same target to hardware (_send_hw_target) or recording it as the new
    current state (set_current_state) — otherwise an abort here (which
    already calls _bridge.stop()) gets immediately undone by the caller's
    own next line, which was never conditioned on this call succeeding."""
    ros_params = {
        "joint_1": joint_1,
        "joint_2": joint_2,
        "joint_3": joint_3,
        "joint_4": joint_4,
        "joint_5": joint_5,
        "joint_6": joint_6,
        "hand": hand,
    }
    try:
        _bridge.move_joints(ros_params)
        return True
    except Exception as e:
        # Same "never fake a success" rule as smooth_move's move-path
        # failure: a silent print here let the twin freeze while the real
        # arm kept moving on the caller's separate hardware target, and the
        # run still reported success.
        _abort_task(
            "Lost connection to the simulator.",
            detail=f"move_joints request failed params={ros_params}: {e}",
        )
        return False


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
        "The robot arm didn't reach the position it was commanded to — stopped for safety.",
        detail=f"twin divergence: commanded {list(target_joints)} but encoders read "
               f"{last_seen} (tol {tol_deg}°)",
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
            "The gripper closed on empty air — the object wasn't picked up.",
            detail=f"hand closed to {_LAST_HW_HAND_MM:.1f}mm "
                   f"(commanded {commanded_close_mm:.1f}mm) — object not detected between fingers",
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
    if SIMULATION_STOP_EVENT.is_set():
        return False
    try:
        payload = {"hand": hand, "hand_only": hand_only}
        if not hand_only:
            j1, j2, j3, j4, j5, j6 = joints
            payload.update({"j1": j1, "j2": j2, "j3": j3, "j4": j4, "j5": j5, "j6": j6})
        result = _bridge.move_target(payload)
    except Exception as e:
        _abort_task("Lost connection to the robot arm.", detail=f"move-target request failed: {e}")
        return False

    if not result.get("ok"):
        _abort_task(
            "The robot arm rejected the last move command.",
            detail=f"move-target response: {result.get('message', 'unknown')}",
        )
        return False

    _LAST_HW_HAND_MM = _parse_hand_mm(result.get("message", ""))

    if not hand_only and not SIMULATION_STOP_EVENT.is_set():
        return _verify_hw_arrival(joints)
    return True


def _wait_for_sim_arrival(target_joints, nominal_s):
    """Wait for the Gazebo twin to reach the commanded pose, up to a budget.

    Deliberately NOT a safety gate, unlike _verify_hw_arrival: it never aborts.
    A missing or stalled joint feed falls back to sleeping out whatever remains
    of the move's nominal duration, which was the entire wait before the twin
    was polled at all. See SIM_ARRIVAL_TOL_DEG for why that sleep alone is not
    enough (sim time vs wall time).

    Polls from the START rather than sleeping the nominal duration first. That
    ordering was the single biggest source of dead time in a run, and it cost
    the most exactly where it was least justified — a hardware run:

        move_path()      → the twin starts executing
        move_target()    → BLOCKS for the real arm's whole motion
        _verify_hw_arrival() → confirms the real arm arrived
        ...then this slept the nominal duration all over again

    The twin has been moving through that entire blocking window, so by the
    time this is reached it has usually already arrived — and the parser then
    stood still for another 1.5-2s per move with the physical arm parked at its
    target. Six to ten moves per pick-and-place made that tens of seconds of
    nothing happening, which is what an operator sees as "long gaps between
    actions".

    Polling first cannot overshoot: at t=0 the twin is still at the previous
    pose, so the tolerance check only passes immediately for a move shorter
    than SIM_ARRIVAL_TOL_DEG, which is a move that needed no wait anyway.
    """
    deadline = time.monotonic() + nominal_s + SIM_ARRIVAL_MAX_EXTRA_S
    started = time.monotonic()
    last_seen = None
    prev = None
    still_samples = 0
    while time.monotonic() < deadline:
        if SIMULATION_STOP_EVENT.is_set():
            return
        try:
            actual = _bridge.get_actual_joints()
        except Exception:
            # No joint feed: fall back to the guarantee this function had
            # before it polled anything — the move's nominal duration.
            _interruptible_sleep(max(0.0, nominal_s - (time.monotonic() - started)))
            return
        # Fewer than 6 values means the feed isn't usable (or is a test double);
        # don't burn the whole extra budget polling something that can't answer.
        if not isinstance(actual, (list, tuple)) or len(actual) < 6:
            _interruptible_sleep(max(0.0, nominal_s - (time.monotonic() - started)))
            return
        last_seen = list(actual[:6])
        if max(abs(t - a) for t, a in zip(target_joints, last_seen)) <= SIM_ARRIVAL_TOL_DEG:
            return
        # Settled-but-short: the controller can stop just outside the tolerance
        # (or the pose is simply unreachable), in which case waiting out the
        # whole budget buys nothing — the arm is no longer moving, which is the
        # only thing the caller actually needs to know. Without this the run
        # stalls for the full SIM_ARRIVAL_MAX_EXTRA_S per segment; seen live
        # 2026-07-30 as two sim_arrival_timeouts adding ~20s to one pick.
        if prev is not None and max(abs(p - a) for p, a in zip(prev, last_seen)) <= SIM_ARRIVAL_STILL_TOL_DEG:
            still_samples += 1
            if still_samples >= SIM_ARRIVAL_STILL_SAMPLES:
                return
        else:
            still_samples = 0
        prev = last_seen
        time.sleep(0.1)
    # Log the actual deltas, not just the fact of the timeout: a large delta
    # means Gazebo never got there (RTF too low, budget too small), a small one
    # means it stopped just outside tolerance. The two need opposite fixes and
    # the bare event name couldn't tell them apart.
    worst = (max(abs(t - a) for t, a in zip(target_joints, last_seen))
             if last_seen else None)
    logger.warning(
        "sim_arrival_timeout",
        extra={"target": list(target_joints), "last_seen": last_seen,
               "worst_delta_deg": worst, "tol_deg": SIM_ARRIVAL_TOL_DEG},
    )
    print(f"[SIMULATOR] Twin didn't reach the commanded pose within "
          f"{SIM_ARRIVAL_MAX_EXTRA_S}s — worst joint off by "
          f"{worst if worst is None else round(worst, 2)}° (tol {SIM_ARRIVAL_TOL_DEG}°)")


def smooth_move(target_joints, hand, duration_s=1.8, hz=20):
    """
    Interpolates movement from current state to target state with ease-in-out curve.
    Uses the currently stored STATE as starting point.
    """
    if SIMULATION_STOP_EVENT.is_set():
        return
    start_joints, start_hand = get_current_state()

    # Calculate angular distance to check if movement is needed
    max_delta = max(abs(t - s) for t, s in zip(target_joints, start_joints))
    hand_delta = abs(hand - start_hand)

    if max_delta < 0.01 and hand_delta < 0.5:
        if not simulate_ros_move(*target_joints, hand):
            return
        set_current_state(target_joints, hand)
        _send_hw_target(target_joints, hand)
        _wait_for_sim_arrival(target_joints, duration_s)
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
        # Don't record a target the simulated arm was never told to reach —
        # every later IK seed and plan would trust a phantom pose.
        _abort_task("Lost connection to the simulator.", detail=f"move-path request failed: {e}")
        return

    set_current_state(target_joints, hand)
    _send_hw_target(target_joints, hand)
    _wait_for_sim_arrival(target_joints, duration_s)


def _send_hw_path(joints_list, hand, max_points: int = None) -> bool:
    """Forward a waypoint path to the real arm one verified PTP move at a
    time — the bulk move-path POST used for Gazebo only carries the final pose
    to hardware, which would collapse a multi-point descent into one point.
    Shared by send_waypoints and simulate_ros_action.

    ``max_points`` caps the TOTAL number of hardware PTP calls for this
    segment, evenly spaced, endpoints always included — see
    HW_MAX_WAYPOINTS_PER_SEGMENT. This is a hard cap, not a stride: a longer
    ramp is thinned harder so the stop count stays the same regardless of how
    dense the Gazebo path is. Default None (every point) —
    simulate_ros_action's Skill playback needs every recorded point to
    reproduce the motion (e.g. an oscillating "shake"), where thinning would
    flatten it; only send_waypoints' straight ramps opt into a cap.
    """
    if not joints_list:
        return True
    n = len(joints_list)
    if max_points is None or max_points >= n:
        indices = list(range(n))
    elif max_points <= 1:
        indices = [n - 1]
    else:
        step = (n - 1) / (max_points - 1)
        indices = sorted({round(i * step) for i in range(max_points)})
        indices[-1] = n - 1  # rounding can leave the last short of n-1
    for i in indices:
        if SIMULATION_STOP_EVENT.is_set():
            return False
        if not _send_hw_target(list(joints_list[i]), hand):
            return False
    return True


def send_waypoints(joints_list, hand, dt):
    """Send a pre-computed IK path to Gazebo as a single move-path POST, and to
    the real arm (when driving hardware) as one verified move per waypoint."""
    if not joints_list or SIMULATION_STOP_EVENT.is_set():
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
        _abort_task("Lost connection to the simulator.", detail=f"move-path request failed: {e}")
        return
    set_current_state(joints_list[-1], hand)
    if _hw_drive_active():
        _send_hw_path(joints_list, hand, max_points=HW_MAX_WAYPOINTS_PER_SEGMENT)
        # _send_hw_path blocks on the real arm's encoders, but the twin runs on
        # sim time and can still be behind — keep both in step before the next
        # segment plans its IK from this pose.
        _wait_for_sim_arrival(joints_list[-1], 0)
    else:
        _wait_for_sim_arrival(joints_list[-1], len(joints_list) * dt)


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
    """Weld 'object' to link_j6, reading the DetachableJoint state topic back.

    A blind publish can succeed (exit 0) while gz-sim silently refuses the
    re-attach (known gz-sim8 quirk on delete+respawn of a same-named entity),
    leaving the object behind on lift — so this reads the state back instead of
    trusting the publish's own exit code.

    But SILENCE IS NOT A NO. That topic publishes on CHANGE, so a read window
    that catches no message means "the plugin said nothing", which is a
    different thing from "the plugin said detached". On a loaded VM the 3s
    echo window routinely closes with nothing in it, and treating that as
    failure aborted the very first pick of a session after ten identical
    retries — reported 2026-09-03, ten lines of "unverified (state output: no
    message)" and a run that never reached the tube.

    So an explicit "detached" is still retried, and silence is passed through
    as inconclusive. It is safe to pass through because the pick no longer
    depends on this answer: `_verify_sim_grasp` watches the object actually
    rise with the arm a moment later, and THAT is the verdict. The plugin's
    self-report is a hint that can save a lift; it was never evidence, which
    is precisely what the stale-child-entity case proved when it reported
    "attached" with nothing welded.
    """
    for attempt in range(1, _ATTACH_MAX_ATTEMPTS + 1):
        print(f"[GRASP] Attach attempt {attempt}/{_ATTACH_MAX_ATTEMPTS}: welding 'object' to link_j6")
        out = _shell_output(ATTACH_AND_VERIFY_CMD) or ""
        if '"attached"' in out or ("attached" in out and "detached" not in out):
            print(f"[GRASP] Attach verified: state topic reports 'attached' (attempt {attempt})")
            return True
        if not out.strip():
            print(f"[GRASP] Attach attempt {attempt}: state topic said nothing — "
                  "proceeding, the lift check is the verdict")
            return True
        print(f"[GRASP] Attach attempt {attempt} reported detached "
              f"(state output: {out.strip()[:120]})")
        if attempt < _ATTACH_MAX_ATTEMPTS:
            _interruptible_sleep(_ATTACH_RETRY_DELAY_S)
    return False


def detach_object_from_gripper() -> bool:
    print("[GRASP] Detach: releasing 'object' from DetachableJoint weld")
    ok = launch_wsl_ros_command(DETACH_CMD)
    if not ok:
        print("[GRASP] WARNING: detach command failed (gz topic returned error)")
    return ok


def get_object_world_z():
    """World Z of the 'object' model, or None if it cannot be read.

    Reads the model pose, which is the first `Pose [ XYZ (m) ]` block `gz model
    -m` prints; the link poses that follow are relative to it.
    """
    out = _shell_output("gz model -m object") or ""
    match = re.search(
        r"Pose \[ XYZ \(m\) \] \[ RPY \(rad\) \]:\s*\n\s*"
        r"\[\s*([-\d.e+]+)\s+([-\d.e+]+)\s+([-\d.e+]+)\s*\]",
        out,
    )
    return float(match.group(3)) if match else None


def _verify_sim_grasp(z_before, z_after, commanded_rise: float) -> bool:
    """Did the object actually come up with the arm?

    `attach_object_to_gripper` asks the DetachableJoint plugin whether it is
    attached, and its own docstring records why that is not free: gz-sim8 can
    silently refuse a re-attach after a same-named entity is deleted and
    respawned. What it does not cover is the case where the plugin BELIEVES it
    attached — the state topic says "attached", the publish returned 0 — while
    holding a stale child entity from before the respawn. Nothing is welded,
    the tube rides up on friction between the closing fingers, and it drops
    somewhere later: on the transit, or partway down the place descent, before
    the gripper has opened. Which is exactly what an operator sees.
    Reported 2026-09-03, on the second pick of a run and never the first —
    the shape you would predict from a stale child entity, since the first
    pick is the only one whose "object" the plugin resolved fresh.

    So this asks the world instead of the plugin. Deltas, not absolutes,
    deliberately: the commanded lift is robot-relative and the model pose is
    world-absolute, and those two frames differ by ROBOT_BASE_Z — a distinction
    this file warns about elsewhere and which a comparison of rises does not
    have to get right.

    Unreadable poses are not treated as a failure. A missed `gz model` read is
    a reason to know less, not a reason to abort a run that may be fine.
    """
    if z_before is None or z_after is None:
        print("[GRASP] lift check skipped: object pose unreadable")
        return True
    risen = z_after - z_before
    if risen >= commanded_rise * 0.5:
        print(f"[GRASP] lift verified: object rose {risen * 1000:.0f}mm "
              f"of {commanded_rise * 1000:.0f}mm commanded")
        return True
    print(f"[GRASP] lift FAILED: object rose {risen * 1000:.0f}mm of "
          f"{commanded_rise * 1000:.0f}mm commanded — the weld did not take")
    return False


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
                      obj_min_z: float = None, grasp_yaw_override: float = None):
    try:
        # Sync state from ROS first to anchor the IK seeds. Abort if it fails —
        # planning from a stale seed risks singularities / collisions.
        if not sync_current_state_from_ros():
            _abort_task(
                "Lost track of the robot arm's position — couldn't start the pick.",
                detail="PICK: could not sync joint state from ROS",
            )
            return

        # Object relative coordinates — use the deterministic spawn XY (Phase 1)
        x_rel = pick_x_rel if pick_x_rel is not None else DEFAULT_PICK_X_REL
        y_rel = pick_y_rel if pick_y_rel is not None else DEFAULT_PICK_Y_REL

        # Phase 2: normalize the object from collision geometry and plan a top-grasp.
        # No object-name branch; infeasible (e.g. too wide for the hand) → skip cleanly.
        model = normalize_object_for_grasp(sdf_name, obj)
        plan = plan_pick_for_object(model, x_rel, y_rel)
        if not plan.feasible:
            # Must abort, not just skip the pick — a skipped pick leaves no
            # signal for the PLACE block that follows, which would then
            # detach/snap an object that was never actually grasped.
            _abort_task(
                f"Couldn't pick up '{sdf_name}' — it isn't shaped for the gripper.",
                detail=f"pick infeasible: {plan.reason} "
                       f"(type={model.collision_type}, width={model.graspable_width * 1000:.1f}mm)",
            )
            return
        if obj_min_z is None:
            obj_min_z = model.min_z
        z_pick = plan.z_pick
        grasp_yaw = plan.tool_yaw if grasp_yaw_override is None else grasp_yaw_override
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
            _abort_task(
                f"Couldn't pick up '{sdf_name}' — no safe path found to reach it.",
                detail=f"pick approach IK failed at x={x_rel:.3f} y={y_rel:.3f} z={z_approach:.3f}",
            )
            return

        debug_fk(q_approach, label="Approach")

        smooth_move(q_approach, ROS_OPEN_GRIPPER, duration_s=2.0)

        # 2. Rampa verticale d'approccio
        vertical_path = build_vertical_ik_path(
            x_rel, y_rel, z_approach, z_pregrasp, grasp_yaw,
            seed_joints=q_approach, n=10
        )
        if not vertical_path:
            _abort_task(
                f"Couldn't pick up '{sdf_name}' — no safe path found to reach it.",
                detail="pick vertical approach IK path failed",
            )
            return
        send_waypoints(vertical_path, ROS_OPEN_GRIPPER, dt=0.30)

        # 3. Rampa verticale finale al punto di pick
        # n=6 (was briefly dropped to 2 while chasing hardware jerkiness —
        # HW_MAX_WAYPOINTS_PER_SEGMENT now owns that trade-off on the
        # hardware side only, so Gazebo keeps the denser path here, which
        # matters most on this exact segment: the final approach to the
        # grasp point, where an operator may need to see/nudge the tube into
        # the fingers).
        final_path = build_vertical_ik_path(
            x_rel, y_rel, z_pregrasp, z_pick, grasp_yaw,
            seed_joints=vertical_path[-1], n=6
        )
        if not final_path:
            _abort_task(
                f"Couldn't pick up '{sdf_name}' — no safe path found to reach it.",
                detail="pick final descent IK path failed",
            )
            return

        # Slow — this is the window where an operator may need to nudge the
        # tube into the fingers by hand if the rack's play left it off-centre.
        send_waypoints(final_path, ROS_OPEN_GRIPPER, dt=0.45)
        pick_joints = final_path[-1]
        debug_fk(pick_joints, label="Pick Point")

        # FK guard: verify TCP is within tolerance of pick target before closing
        target_urdf = np.array([-y_rel, x_rel, z_pick + URDF_GAZEBO_Z_OFFSET])
        pos_err, _ = fk_position_error(pick_joints, target_urdf)
        if pos_err > IK_POS_TOL:
            _abort_task(
                f"Couldn't pick up '{sdf_name}' — the arm didn't reach the object precisely enough.",
                detail=f"pick FK guard: pos_err={pos_err * 1000:.1f}mm > {IK_POS_TOL * 1000:.0f}mm",
            )
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
            snap_z = (TABLE_TOP_Z_ABS - (obj_min_z or 0.0) + PICK_Z_FINE_TUNE
                      + rack_lift_for_width(model.graspable_width))
            print(f"[GRASP] snap pose x={snap_x:.4f} y={snap_y:.4f} z={snap_z:.4f} yaw={grasp_yaw:.4f}")
            if not set_object_world_pose(snap_x, snap_y, snap_z, yaw=grasp_yaw):
                _abort_task(
                    f"Couldn't pick up '{sdf_name}' — the object didn't attach to the gripper.",
                    detail="pick snap-to-TCP failed (set_pose) — refusing to weld, would float",
                )
                return
            # Object is already held at rest, so the snap is authoritative; tight
            # delay just lets the re-parent settle before the weld.
            _interruptible_sleep(0.05)
            if not attach_object_to_gripper():
                _abort_task(
                    f"Couldn't pick up '{sdf_name}' — the object didn't attach to the gripper.",
                    detail=f"pick weld failed: DetachableJoint reported 'detached' on all "
                           f"{_ATTACH_MAX_ATTEMPTS} attempts — object would be left behind",
                )
                return
            _interruptible_sleep(0.2)
        else:
            print("[GRASP] Attach skipped (do_attach=False: spawn failed or disabled)")
        z_before_lift = get_object_world_z() if do_attach else None

        # Close fingers for the visual grip — object already welded, contact now harmless.
        # Slow (was 0.7s): gives an operator time to help seat the tube by hand if needed.
        smooth_move(pick_joints, hand_close, duration_s=1.5)
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

        # The weld is confirmed by watching the object move, not by asking the
        # plugin whether it thinks it attached. Same rule as every other gate
        # in this file: a pick that did not take must stop here, not continue
        # into a transit and a descent and drop the tube somewhere on the way.
        if do_attach and not _verify_sim_grasp(
            z_before_lift, get_object_world_z(), z_carry - z_pick
        ):
            _abort_task(
                f"'{sdf_name}' didn't come up with the gripper — the grasp didn't hold.",
                detail="pick lift check: object did not rise with the arm; the "
                       "DetachableJoint reported 'attached' but nothing is welded "
                       "(stale child entity after delete+respawn)",
            )
            return

        # Store pick context for place phase (gantry transit Z-down)
        simulation_recursive_blockly_parser.last_pick_x = x_rel
        simulation_recursive_blockly_parser.last_pick_y = y_rel
        simulation_recursive_blockly_parser.last_pick_z_carry = z_carry
        simulation_recursive_blockly_parser.last_pick_grasp_yaw = grasp_yaw
        simulation_recursive_blockly_parser.last_pick_hand_close = hand_close
        simulation_recursive_blockly_parser.last_pick_carry_joints = carry_joints
        # Arm stays at carry pose Z-down with object; no home until place releases

    except Exception as e:
        _abort_task(f"Couldn't pick up '{sdf_name}' — something went wrong.", detail=f"pick failed: {e}")


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


# No defaults: every parameter is always supplied by the one production caller
# and by the tests. location_name in particular used to default to a catalog
# entry ("collection rack") that has since been replaced — a default naming a
# location folder is a silent trap the moment the catalog changes under it.
def simulate_ros_place(picked_obj_name: str, objectsOfUser, location_name: str):
    try:
        # Sync state from ROS. Abort if it fails — a stale IK seed risks
        # singularities / collisions on the descent.
        if not sync_current_state_from_ros():
            # Must abort, not just return — otherwise the run reports
            # success with the object silently never placed.
            _abort_task(
                "Lost track of the robot arm's position — couldn't start the place.",
                detail="PLACE: could not sync joint state from ROS",
            )
            return

        # Retrieve picked object's metrics if available
        obj = None
        if objectsOfUser is not None and picked_obj_name:
            obj = objectsOfUser.filter(name=picked_obj_name).first()

        height_m, width_m = resolve_object_metrics(obj, picked_obj_name)
        if height_m is None or width_m is None:
            _abort_task(
                f"Couldn't place '{picked_obj_name}' — its dimensions aren't known.",
                detail=f"PLACE: could not resolve dimensions for '{picked_obj_name}'",
            )
            return
        width_mm = width_m * 1000.0

        # Close gap
        hand_close = int(max(0.0, min(30.0, width_mm - 0.5)))

        # Target coordinates (slot cycling for multi-slot locations)
        safe_loc_name = location_name.replace(" ", "_").lower()
        slot_cfg = LOCATION_PROFILES.get(safe_loc_name)
        if slot_cfg:
            slot_idx = getattr(simulation_recursive_blockly_parser, "place_slot_index", 0)
            offsets = slot_cfg["slot_xy_offsets"]
            if slot_idx >= len(offsets):
                # Wraps silently by design (a repeat() with more iterations
                # than physical slots must not abort), but stacking two
                # objects in the same slot is worth a loud warning, not just
                # the quiet per-slot log line below.
                print(f"[WARNING] PLACE: slot index {slot_idx} exceeds the "
                      f"{len(offsets)} configured slot(s) for this location — "
                      f"wrapping to slot {slot_idx % len(offsets)}, which may already hold an object.")
            dx, dy = offsets[slot_idx % len(offsets)]
            x_rel = DEFAULT_PLACE_X_REL + dx
            y_rel = DEFAULT_PLACE_Y_REL + dy
            simulation_recursive_blockly_parser.place_slot_index = slot_idx + 1
            print(f"[SIMULATOR] Slot {slot_idx % len(offsets)}: x_rel={x_rel:.3f} y_rel={y_rel:.3f}")
        else:
            x_rel = DEFAULT_PLACE_X_REL
            y_rel = DEFAULT_PLACE_Y_REL

        # Z target — shared with testing/calibrate_rack.py's `goto-place` so
        # the two can never diverge again (see resolve_place_z docstring).
        # loc_height/floor_height/is_container are still needed below too,
        # for the world-frame snap-to-slot Z (a separate computation from
        # the robot-frame descent target resolve_place_z returns).
        loc_height = resolve_location_metrics(location_name)
        z_place = resolve_place_z(location_name, height_m)
        _, floor_height, is_container = get_location_profile(safe_loc_name)
        if is_container and floor_height is not None:
            print(f"[SIMULATOR] Container place: floor={floor_height:.3f} z_place={z_place:.3f}")
        z_up = z_place + 0.12

        # Rack slots may need a rotated grasp to clear neighboring tubes — same
        # config the pick side reads (LOCATION_PROFILES[...]["grasp_yaw"]).
        grasp_yaw = slot_cfg.get("grasp_yaw", 0.0) if slot_cfg else 0.0

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
                    f"Couldn't place '{picked_obj_name}' at '{location_name}' — no safe path found.",
                    detail=f"place transit IK failed at z_carry={z_carry:.3f} "
                           f"({pick_x:.2f},{pick_y:.2f}) → ({x_rel:.2f},{y_rel:.2f})",
                )
                return

            # 2. Vertical descent Cartesian Z-down: z_carry → z_place
            descent_path = build_vertical_ik_path(
                x_rel, y_rel, z_carry, z_place, pick_grasp_yaw,
                seed_joints=q_above_place, n=10
            )
            if not descent_path:
                _abort_task(
                    f"Couldn't place '{picked_obj_name}' at '{location_name}' — no safe path found.",
                    detail=f"place descent IK failed at ({x_rel:.2f},{y_rel:.2f}) z={z_place:.3f}",
                )
                return
            send_waypoints(descent_path, hand_close, dt=0.20)
            place_joints = descent_path[-1]
            target_urdf_place = np.array([-y_rel, x_rel, z_place + URDF_GAZEBO_Z_OFFSET])
            place_pos_err, _ = fk_position_error(place_joints, target_urdf_place)
            print(f"[PLACE] FK guard: pos_err={place_pos_err * 1000:.1f}mm (x={x_rel:.3f} y={y_rel:.3f} z={z_place:.3f})")
            if place_pos_err > IK_POS_TOL:
                _abort_task(
                    f"Couldn't place '{picked_obj_name}' at '{location_name}' — "
                    "the arm didn't reach the spot precisely enough.",
                    detail=f"place FK guard: {place_pos_err * 1000:.1f}mm off target — refusing to release",
                )
                return
            q_retreat = q_above_place

        else:
            # No pick context (place called without a preceding pick this run).
            print("[SIMULATOR] No pick context — solving place approach directly")
            q_up = solve_gazebo_ik(x_rel, y_rel, z_up, grasp_yaw, seed_joints=current_joints)
            if not q_up:
                _abort_task(
                    f"Couldn't place '{picked_obj_name}' at '{location_name}' — no safe path found.",
                    detail=f"place approach IK failed at ({x_rel:.2f},{y_rel:.2f}) z={z_up:.3f}",
                )
                return
            smooth_move(q_up, hand_close, duration_s=2.0)

            vertical_path = build_vertical_ik_path(
                x_rel, y_rel, z_up, z_place, grasp_yaw,
                seed_joints=q_up, n=8
            )
            if not vertical_path:
                _abort_task(
                    f"Couldn't place '{picked_obj_name}' at '{location_name}' — no safe path found.",
                    detail=f"place descent IK failed at ({x_rel:.2f},{y_rel:.2f}) z={z_place:.3f}",
                )
                return
            send_waypoints(vertical_path, hand_close, dt=0.20)
            place_joints = vertical_path[-1]
            target_urdf_place = np.array([-y_rel, x_rel, z_place + URDF_GAZEBO_Z_OFFSET])
            place_pos_err, _ = fk_position_error(place_joints, target_urdf_place)
            if place_pos_err > IK_POS_TOL:
                _abort_task(
                    f"Couldn't place '{picked_obj_name}' at '{location_name}' — "
                    "the arm didn't reach the spot precisely enough.",
                    detail=f"place FK guard: {place_pos_err * 1000:.1f}mm off target — refusing to release",
                )
                return
            q_retreat = q_up

        # 3. Detach → snap object to slot → open gripper
        if not detach_object_from_gripper():
            # The snap-to-slot below assumes the weld already let go —
            # teleporting a still-welded object is undefined. Abort instead
            # of continuing as if the detach had succeeded.
            _abort_task(
                f"Couldn't release '{picked_obj_name}' cleanly — check the gripper before continuing.",
                detail="place detach failed (gz topic) — refusing to snap-to-slot on a still-welded object",
            )
            return
        _interruptible_sleep(0.1)
        # Snap-to-slot: teleport object to exact slot centre so it always lands in the hole.
        snap_x = ROBOT_BASE_X + x_rel
        snap_y = ROBOT_BASE_Y + y_rel
        _, _, obj_place_min_z = get_sdf_dimensions(picked_obj_name)
        if is_container and floor_height is not None:
            snap_z_slot = TABLE_TOP_Z_ABS + floor_height - (obj_place_min_z or 0.0)
        else:
            snap_z_slot = TABLE_TOP_Z_ABS + loc_height - (obj_place_min_z or 0.0)
        print(f"[PLACE] snap-to-slot x={snap_x:.4f} y={snap_y:.4f} z={snap_z_slot:.4f} yaw={grasp_yaw:.4f}")
        if not set_object_world_pose(snap_x, snap_y, snap_z_slot, yaw=grasp_yaw):
            # The weld is already released above — this can't undo the detach —
            # but continuing would let _persist_placed_object spawn a fresh
            # entity at snap_x/y/z as if the teleport succeeded, reporting a
            # confident "placed" when reality is unknown. Abort instead of
            # letting the place finish as if nothing happened.
            _abort_task(
                f"Lost track of '{picked_obj_name}' after releasing it — check the workcell "
                "before running again.",
                detail="place snap-to-slot failed (set_pose) — object position after detach is unknown",
            )
            return
        _interruptible_sleep(0.2)
        smooth_move(place_joints, ROS_OPEN_GRIPPER, duration_s=0.6)
        _interruptible_sleep(0.5)

        # 4. Retreat up (empty gripper from here: joint interp OK)
        smooth_move(q_retreat, ROS_OPEN_GRIPPER, duration_s=1.5)

        # Persist the placed object under its own identity now that the arm is
        # clear of the slot — otherwise the next pick's cleanup of the reusable
        # "object" entity would delete the item that was just placed.
        _persist_placed_object(picked_obj_name, snap_x, snap_y, snap_z_slot,
                               yaw=grasp_yaw, location=_safe_gz_entity_name(location_name))

        # 5. Return to home
        simulate_ros_initial_position(gripper_open=True)

        # Clear pick context
        simulation_recursive_blockly_parser.last_pick_carry_joints = None
        simulation_recursive_blockly_parser.last_pick_x = None

    except Exception as e:
        _abort_task(f"Couldn't place '{picked_obj_name}' — something went wrong.", detail=f"place failed: {e}")


def simulate_ros_action(action_points: list = []):
    """Play back a Skill's recorded waypoints on the Gazebo twin and, when
    hardware drive is active, on the real arm too (one verified PTP move per
    waypoint via _send_hw_path — the plain move-path used elsewhere only
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
        joints_list = [
            [point["j1"], point["j2"], point["j3"], point["j4"], point["j5"], point["j6"]]
            for point in action_points
        ]
        waypoints = [
            {"j1": j[0], "j2": j[1], "j3": j[2], "j4": j[3], "j5": j[4], "j6": j[5],
             "hand": cur_hand, "dt": 1.0}
            for j in joints_list
        ]
        try:
            _bridge.move_path(waypoints)
        except Exception as e:
            _abort_task("Lost connection to the simulator.", detail=f"move-path request failed: {e}")
            return

        if _hw_drive_active():
            if not _send_hw_path(joints_list, cur_hand):
                return
        else:
            _interruptible_sleep(len(waypoints) * 1.0)

        set_current_state(joints_list[-1], cur_hand)

    except Exception as e:
        # Must abort, not silently no-op — a malformed waypoint (bad JSON,
        # missing joint key) here would otherwise let the run report
        # success with the operator believing the Skill ran.
        _abort_task(
            "Couldn't play the recorded motion — its saved points look corrupted.",
            detail=f"simulate_ros_action failed: {e}",
        )


def reset_simulation_world():
    global _LAST_HW_HAND_MM
    try:
        # Also per-run state — otherwise _verify_hw_grasp's first call
        # on a fresh run can read the previous run's gripper aperture instead
        # of "no data yet".
        _LAST_HW_HAND_MM = None

        # Reset slot cycling counters and spawned-object tracking.
        simulation_recursive_blockly_parser.place_slot_index = 0
        simulation_recursive_blockly_parser.pick_slot_index = 0
        _spawned_in_world.clear()

        # Reset the last-pick context too — these are function attributes
        # that otherwise survive across runs. Without this, a second run
        # that places without picking first (or whose first pick fails
        # before setting them) inherits the previous run's grasp yaw / hand
        # aperture / carry pose instead of the "no pick context" defaults.
        simulation_recursive_blockly_parser.last_pick_x = None
        simulation_recursive_blockly_parser.last_pick_y = None
        simulation_recursive_blockly_parser.last_pick_z_carry = None
        simulation_recursive_blockly_parser.last_pick_grasp_yaw = None
        simulation_recursive_blockly_parser.last_pick_hand_close = None
        simulation_recursive_blockly_parser.last_pick_carry_joints = None
        simulation_recursive_blockly_parser.last_picked_object = None

        # Detach before delete: removing a welded child without detaching first
        # can leave the plugin in a stale attached state across the next spawn.
        print("[GRASP] Reset: detaching before world cleanup")
        detach_object_from_gripper()
        _interruptible_sleep(0.2)

        # Wait for the removals instead of sleeping a fixed 0.3s at them. A
        # missing entity is fine (first run of the session); an entity that is
        # STILL THERE afterwards is not, and used to be indistinguishable —
        # both printed nothing and the next spawn landed on top.
        remove_entity_and_wait("object")
        remove_entity_and_wait("location")
        global _spawned_location_name
        _spawned_location_name = None

        _delete_placed_objects()
        _interruptible_sleep(1.0)
        simulate_ros_initial_position(gripper_open=True)
        _interruptible_sleep(3.0)
    except Exception as e:
        print(f"[SIMULATOR] reset_simulation_world failed: {e}")


def delete_spawned_object_and_place():
    """Remove the reusable "object" entity so PICK/PLACE can repeat without
    resetting the entire world.

    It is spawned under a fixed name (no allow_renaming), so a second PICK in
    the same run needs the previous entity gone first or the spawn RPC returns
    data:false. Persisted placed_* copies (see _persist_placed_object) are
    deliberately left alone here so they survive across repeat() iterations;
    they're swept only on reset_simulation_world()/stop_simulation().

    It does NOT touch "location" any more, and that is the point.

    It used to remove both, from all three call sites — the start of a pick and
    the end of each repeat/repeat-until iteration. But a pick never spawns a
    location; only _h_place does. So the destination container was being
    deleted at the start of every pick and only reappearing when the next place
    recreated it, which an operator sees as the cup blinking out for the whole
    pick and transit.

    Worse than cosmetic: a tube already placed inside it was resting on it.
    Removing the container mid-run dropped that tube onto the table (reported
    2026-09-03: "cup riapparso con però provetta gialla ormai a terra"). The
    place path persists each placed object precisely so it survives the next
    pick — and then this deleted the thing holding it up.

    The stale location is now cleared where it is actually about to be
    replaced: in _h_place, right before the spawn, and only when the
    destination has changed.
    """
    try:
        # Detach before delete: prevents stale weld state across repeated runs.
        print("[GRASP] Cleanup: detaching welded child before removing 'object'")
        detach_object_from_gripper()
        _interruptible_sleep(0.2)
        # Waited on, not slept at — this runs BETWEEN two picks in the same
        # run, so the next spawn follows immediately and the window this
        # closes is at its narrowest exactly here.
        remove_entity_and_wait("object")
        _spawned_in_world.clear()
    except Exception as e:
        print(str(e))


def _persist_placed_object(sdf_name: str, x: float, y: float, z: float, yaw: float = 0.0,
                           location: str = None) -> bool:
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
    safe_sdf_name = _safe_gz_entity_name(sdf_name)
    if safe_sdf_name is None:
        print(f"[SIMULATOR] persist-placed: unsafe object name '{sdf_name}' — skipping persistence")
        return False
    # Detach before removing, like the other two sites that remove "object"
    # (reset_simulation_world and delete_spawned_object_and_place, both of
    # which say so in their own comments). This was the only one of the three
    # that did not, and it is the one that runs on EVERY place.
    #
    # Removing a model while the DetachableJoint still holds it strands a
    # physics entity, and gz-sim then prints
    #     [Err] [Physics.cc:2967] Internal error: a physics entity ptr with an
    #     ID of [N] does not exist.
    # once per physics step for the rest of the session. Reproduced
    # deliberately on the live twin on 2026-09-03: spawn "object", attach,
    # then remove WITHOUT detaching — the storm starts immediately and does
    # not stop. The id in the message is the physics engine's own numbering,
    # not an ECM entity id, so it identifies nothing lookupable and changes
    # between runs; that is why the message is so hard to act on.
    #
    # This site relied on simulate_ros_place having detached ~2.6s earlier
    # (release, open gripper, retreat, then persist). That is true on the
    # happy path, but the plugin carries a PENDING AUTO-ATTACH — the reason
    # _h_pick detaches twice right after every spawn — so "nothing re-welded
    # it in the meantime" is an assumption this function was making about
    # code several steps away. A second detach on an already-released joint
    # is a no-op, which is why _h_pick can afford to send two.
    print("[GRASP] persist-placed: detaching before removing 'object'")
    detach_object_from_gripper()
    _interruptible_sleep(0.2)
    if not remove_entity_and_wait("object"):
        print("[SIMULATOR] persist-placed: 'object' did not go away — skipping persistence")
        return False

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
    with _PLACED_LOCK:
        _placed_in_world.append((placed_name, location))
    print(f"[SIMULATOR] Persisted placed object '{placed_name}' ({sdf_name}) at "
          f"x={x:.4f} y={y:.4f} z={z:.4f}")
    return True


def remove_entity_and_wait(name: str, timeout_s: float = 4.0) -> bool:
    """Remove a Gazebo model and block until it is really gone.

    `gz service .../remove` returning true means the removal was ACCEPTED, not
    that it happened: gz-sim applies entity removals at the end of an update
    cycle. Creating a same-named model inside that window is the failure this
    exists to prevent, and it is not theoretical — the physics engine says so
    itself:

        Msg [NameManager::issueNewName] The name [object/link] is a duplicate,
        so it has been renamed to [object/link(1)]

    Once that happens the DetachableJoint plugin and the Physics system are
    holding a reference to the corpse: the `Physics.cc:2967 ... entity ptr with
    an ID of [N] does not exist` storm runs for the rest of the session, and
    the weld silently refuses. Reproduced in an isolated world at roughly one
    remove-then-recreate cycle in five, which is exactly the rate an operator
    starting and stopping a run repeatedly would meet.

    Returns True when the world no longer lists `name` (including when it never
    did). False means the model is still there after `timeout_s`, and the
    caller must NOT spawn over it — that is the corrupted-world case, and a
    clear abort beats a run that behaves strangely for reasons nobody can see.
    """
    # Don't ask for a removal that has nothing to remove. gz-sim answers a
    # miss with `[Err] [UserCommands.cc:1120] Entity named [object] of type [2]
    # not found, so not removed.` — harmless, but it is an ERROR line, and this
    # helper is called at the start of every run and before every pick, so the
    # console fills with red text that means nothing. That is not cosmetic: it
    # is the same console where a real fault has to be spotted, and the noise
    # is what made `Physics.cc:2967` hard to find among it.
    #
    # Only skip on a POSITIVE reading. A listing that failed or timed out says
    # nothing about whether the model is there, and treating silence as absence
    # would skip a removal that was needed.
    listing = _shell_output("gz model --list") or ""
    if "Available models" in listing and not any(
        line.strip() == f"- {name}" for line in listing.splitlines()
    ):
        return True

    launch_wsl_ros_command(
        'gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity '
        '--reptype gz.msgs.Boolean --timeout 5000 '
        f"--req 'type: MODEL, name: \"{name}\"'"
    )
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        listing = _shell_output("gz model --list") or ""
        # A failed/timed-out listing is not evidence of absence. Retry rather
        # than reading "the service did not answer" as "the model is gone".
        if "Available models" in listing:
            if not any(line.strip() == f"- {name}" for line in listing.splitlines()):
                return True
        time.sleep(0.25)
    print(f"[SIMULATOR] '{name}' still present {timeout_s:.0f}s after remove")
    return False


def _delete_placed_objects(location: str = None):
    """Sweep persisted placed_* entities.

    ``location=None`` takes all of them (world reset / STOP). Naming a
    destination takes only what was placed in THAT one, which is what a place
    into a different container needs: those objects are independent top-level
    models, so removing the container they were resting in does not remove
    them — it drops them onto the bench.

    Deleting them is the honest reading of what just happened: the container
    left the world and so did what it held. The alternative the operator saw
    before this was tubes tumbling across the table with nothing to explain
    it. The real fix is a bench layout where every destination has its own
    place and none of them ever leave; that needs positions this cell does not
    have yet, and a recalibration of where the arm places for each.
    """
    global _placed_in_world
    # Snapshot-and-clear atomically so a concurrent _persist_placed_object
    # append (run thread) can't be lost between the read and the reassign —
    # the actual `gz` deletes run outside the lock since each can take
    # seconds and shouldn't block a concurrent append.
    with _PLACED_LOCK:
        if location is None:
            entries, _placed_in_world = _placed_in_world, []
        else:
            entries = [e for e in _placed_in_world if e[1] == location]
            _placed_in_world = [e for e in _placed_in_world if e[1] != location]
    names = [name for name, _ in entries]

    if location is None:
        # Ask the WORLD as well, not only this process's memory.
        #
        # The registry is cleared before the deletes are even sent, and a
        # delete that does not take is only printed — so an entity that
        # survives becomes one nobody can name again, and the next run's sweep
        # finds an empty list. `stop_simulation` makes that likely rather than
        # theoretical: it requests these deletes and then pauses the world,
        # and gz-sim applies entity removals at the END of an update cycle,
        # which a paused world does not run.
        #
        # Reported 2026-09-03: "se annullo una simulazione e poi ne avvio una
        # successiva restano oggetti della prova precedente".
        #
        # Listing by name covers the same gap for a Django restart, where the
        # registry starts empty while the world does not.
        listing = _shell_output("gz model --list") or ""
        if "Available models" in listing:
            for line in listing.splitlines():
                entry = line.strip()
                if entry.startswith("- placed_"):
                    stray = entry[2:]
                    if stray not in names:
                        print(f"[SIMULATOR] sweep: '{stray}' left over from an "
                              f"earlier run — removing")
                        names.append(stray)

    for name in names:
        cmd = (
            f'gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity '
            f'--reptype gz.msgs.Boolean --timeout 5000 --req \'type: MODEL, name: "{name}"\''
        )
        if not launch_wsl_ros_command(cmd):
            print(f"[SIMULATOR] sweep: delete '{name}' failed (may not exist)")


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
        try:
            obj_data = loads(condition_block["inputs"]["OBJECT"]["block"]["data"])
        except (KeyError, TypeError, ValueError):
            obj_data = {}
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
    elif block_type == EventsItems.HUMAN_FEEDBACK.value:
        label = "Operator confirm"
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
    if coco_class == "test tube":
        # YOLOE labels the uncapped tube "beaker", not "test tube" — same
        # object, no cap silhouette to key off (2026-07-27 live camera test).
        # This is a VISION VOCABULARY alias, unrelated to the "beaker"
        # catalog object removed 2026-07-29 (seed_library.py) — keep this
        # even though no object is literally named "beaker" anymore, or
        # find_object on an uncapped tube stops matching real detections.
        accepted.add("beaker")
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
        entry_time = time.monotonic()
        # Probe bridge once before entering the wait loop.
        # If unreachable (camera/gesture engine off) bypass immediately.
        try:
            _bridge.get_vision_state()
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout,
                requests.exceptions.HTTPError):
            if STRICT_CONDITIONS:
                logger.warning("condition_failed", extra={"reason": "bridge_unreachable", "block": "gesture_block"})
                _abort_task(
                    "The task stopped because the camera isn't reachable.",
                    detail=f"gesture '{gesture}': vision bridge unreachable (STRICT_CONDITIONS)",
                )
                return False
            logger.warning("condition_bypassed", extra={"reason": "bridge_unreachable", "block": "gesture_block"})
            _mark_condition_bypass("bridge_unreachable")
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
        # Gesture arrives by polling, not as a request, so a wrong gesture is
        # never an event the way a wrong spoken word is (which POSTs to
        # /api/voice-command and is counted there). Logging each *transition*
        # to a new non-empty gesture recovers a comparable attempt count:
        # without it "number of attempts" simply does not exist for this
        # channel, and cannot be put beside voice and button.
        last_seen = None
        # A gesture is a LEVEL, not an event: the browser reports whatever the
        # hand is doing right now, ten times a second. Voice and the confirm
        # button get edge semantics for free — reset on entry, consume on read,
        # so one utterance satisfies exactly one step. Gesture had nothing
        # equivalent, and the freshness check below cannot supply it: the age
        # it reads is the age of the last REPORT, and vision_live posts every
        # frame (including "NONE"), so it is always ~0 while the webcam
        # streams. A thumb still raised from the previous step therefore
        # satisfied this one instantly.
        #
        # That is invisible on a single confirm and fatal in a loop: a
        # repeat_until whose exit condition is a gesture exited after one
        # iteration, every time, because the operator's hand had not moved yet.
        #
        # So require a transition: the expected gesture must be seen ABSENT at
        # least once during this wait before it can satisfy it. In the normal
        # case — the operator waiting for the prompt before gesturing — the
        # first poll sees NONE and this costs nothing.
        released = False
        while time.monotonic() < deadline:
            if SIMULATION_STOP_EVENT.is_set():
                break
            try:
                poll_time = time.monotonic()
                state = _bridge.get_vision_state()
                age = state.get("gesture_age_s")
                # Reject a gesture reported before this step started (stale
                # replay) — a value held from a prior step/run must not
                # satisfy this one. Permissive when the bridge omits the
                # age field, to not break against an older bridge.
                reported_at = poll_time - age if age is not None else None
                is_fresh = reported_at is None or reported_at >= entry_time - GESTURE_FRESHNESS_SLOP_S
                observed = state.get("gesture")
                if observed != last_seen:
                    last_seen = observed
                    if observed and observed != "NONE" and is_fresh:
                        study_log.log_event(
                            "attempt",
                            channel="gesture",
                            value=observed,
                            accepted=observed == gesture,
                        )
                if observed != gesture:
                    released = True
                if observed == gesture and is_fresh and released:
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
        try:
            obj_data = loads(condition_block["inputs"]["OBJECT"]["block"]["data"])
        except (KeyError, TypeError, ValueError):
            # Unresolved OBJECT slot (empty shadow, never filled in) — fall
            # through with an empty name so this behaves like "never
            # detected" (abort on timeout) instead of crashing the parser.
            obj_data = {}
        obj_name = obj_data.get("name", "")
        coco_class, color = parse_object_query(obj_name)
        # If bridge is unreachable, bypass immediately.
        # Object presence is a continuous state, not a momentary event like a
        # gesture, so the gesture freshness check (which asks "was this
        # reported after the step started?") has no equivalent here: the
        # detection topic republishes at ~2 Hz for as long as the object stays
        # in frame, so its age is always small no matter when it appeared.
        # Under STRICT_CONDITIONS the operator must therefore cause a
        # transition — the object has to be seen absent at some point and then
        # appear — otherwise an object already sitting in frame satisfies the
        # step in 0 s with no human involvement, which is not a measurable
        # confirmation.
        seen_absent = False
        try:
            state = _bridge.get_vision_state()
            if _detections_match(state, coco_class, color):
                if not STRICT_CONDITIONS:
                    print(f"[CONDITION] Object '{obj_name}' detected immediately!")
                    # Already in frame at step entry: nothing the operator did.
                    _mark_condition_bypass("object_already_in_frame")
                    return True
                print(f"[CONDITION] Object '{obj_name}' already in frame — "
                      f"waiting for it to leave and reappear (STRICT_CONDITIONS)")
            else:
                seen_absent = True
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
            if STRICT_CONDITIONS:
                logger.warning("condition_failed", extra={"reason": "bridge_unreachable", "block": "find_object_block"})
                _abort_task(
                    "The task stopped because the camera isn't reachable.",
                    detail=f"find_object '{obj_name}': vision bridge unreachable (STRICT_CONDITIONS)",
                )
                return False
            logger.warning("condition_bypassed", extra={"reason": "bridge_unreachable", "block": "find_object_block"})
            _mark_condition_bypass("bridge_unreachable")
            print(f"[CONDITION] Vision bridge unreachable — bypassing find_object '{obj_name}'")
            try:
                _bridge.notify("/api/human-step-timeout",
                               {"condition": "object", "value": obj_name,
                                "bypass_reason": "bridge_unreachable"})
            except Exception:
                pass
            return True
        # NO "it was spawned in this run, so it counts as seen" shortcut here.
        # `_spawned_in_world` records what a pick put into Gazebo, and reading
        # it here made the condition tautological inside a loop: a repeat_until
        # whose body picks a blue tube and whose exit test is "blue tube
        # detected" found the name in that set and left after one iteration,
        # every time, without the camera ever being consulted. The order in
        # _h_repeat_until is body, then exit test, then cleanup — so the set
        # still holds what the body just picked at the moment the test runs.
        #
        # Removing it does not strand a run with no vision: the
        # bridge-unreachable branch above still answers True when the vision
        # bridge is down (development without the ROS stack, vision:=false).
        # What is gone is answering True while the bridge is UP and the camera
        # is looking at nothing — and the study checklist requires the camera
        # to be up (studio-utenti/09-checklist-setup.md: "ENABLE_VISION=1 non e'
        # opzionale"), so during a session this only ever spoke over a camera
        # that was deliberately switched on.
        #
        # The set itself stays: _h_pick reads it to clean up a previous pick's
        # entity before spawning the next one.
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
                    # Under STRICT_CONDITIONS a match only counts once the
                    # object has been observed absent, so what is measured is
                    # the operator putting it there, not the fact that it
                    # happened to already be in view.
                    if seen_absent or not STRICT_CONDITIONS:
                        detected = True
                        break
                else:
                    seen_absent = True
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
            _abort_task(
                f"Couldn't find '{obj_name}' — check it's in view of the camera and try again.",
                detail=f"find_object timeout: '{obj_name}' not detected within {timeout}s",
            )
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
        from backend.functions.vision_live import (
            get_latest_voice, reset_voice, set_expected_voice,
        )

        word = condition_block.get("fields", {}).get("VOICE_WORD") or "YES"
        print(f"[CONDITION] Waiting for voice command: {word} (timeout {timeout}s)...")
        reset_voice()  # drop any word heard before this step started (stale replay)
        # Publish what we are waiting for, so the endpoint that receives the
        # operator's utterances can record `accepted` with the same meaning the
        # gesture channel gives it. Cleared right after the loop — on both the
        # matched and the timed-out exit — because outside a voice step there
        # is no expected word, and a stale one would mark a later utterance as
        # accepted for a step that is no longer running.
        set_expected_voice(word)
        deadline = time.monotonic() + timeout
        detected = False
        while time.monotonic() < deadline:
            if SIMULATION_STOP_EVENT.is_set():
                break
            if get_latest_voice(consume=True) == word:
                detected = True
                break
            _interruptible_sleep(0.5)
        set_expected_voice(None)
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

    elif block_type == EventsItems.HUMAN_FEEDBACK.value:
        # Pure UI confirm — no sensor. Same cache shape as voice: drain at
        # entry so a press from before this step started can't satisfy it,
        # consume on read so it can't satisfy more than one step.
        from backend.functions.vision_live import get_confirm, reset_confirm

        print(f"[CONDITION] Waiting for operator confirm (timeout {timeout}s)...")
        reset_confirm()
        deadline = time.monotonic() + timeout
        detected = False
        while time.monotonic() < deadline:
            if SIMULATION_STOP_EVENT.is_set():
                break
            if get_confirm(consume=True):
                detected = True
                break
            _interruptible_sleep(0.5)
        if not detected:
            print(f"[WARNING] Operator confirm not received within {timeout}s — continuing")
            try:
                _bridge.notify("/api/human-step-timeout",
                               {"condition": "human_feedback", "value": ""})
            except Exception:
                pass
        else:
            print("[CONDITION] Operator confirm received!")
        return detected

    # Fallback: retired types (sensor_signal, touch_detect) and anything the
    # five handled types above don't cover. This is the real-wait path, so
    # returning "fulfilled" here would resume the arm on a condition nobody
    # checked, and returning False would skip the branch silently. Both are
    # worse than stopping: abort loudly instead.
    print(f"[WARNING] Unsupported condition '{block_type}' — aborting task")
    _abort_task(
        "This task uses a condition the system can no longer verify — "
        "replace that step and run it again.",
        detail=f"unsupported condition type '{block_type}' reached the "
               f"_wait_for_condition fallback (retired block in a saved workspace)",
    )
    return False


def _move_to_scan_pose():
    """Move robot to SCAN_POSE if not already there, then settle for detection."""
    current_joints, current_hand = get_current_state()
    max_delta = max(abs(t - s) for t, s in zip(SCAN_POSE, current_joints))
    if max_delta > 2.0:  # degrees threshold — skip move if already in scan pose
        print(f"[SCAN] Moving to scan pose {SCAN_POSE}")
        # Hold the current gripper aperture instead of forcing it open — a
        # find_object condition can run mid-carry (e.g. inside a when block
        # after a pick), and forcing the gripper open here would drop
        # whatever it's holding, same fix as simulate_ros_action above.
        smooth_move(SCAN_POSE, current_hand)
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


def _condition_step_payload(condition_block: dict) -> dict | None:
    """Extract {"condition": ..., "value": ...} for the human-step-start
    countdown/self-view UI from a single (non-compound) condition block.

    Returns None for AND/OR/NOT/timer — those don't map to one condition/
    value pair the UI can show a countdown for. The condition still
    evaluates and the task is unaffected either way; it just runs without
    the live wait UI, same as before this fix existed.
    """
    ev_type = condition_block.get("type", "")
    if ev_type == EventsItems.GESTURE.value:
        return {"condition": "gesture",
                "value": condition_block.get("fields", {}).get("GESTURE_TYPE", "THUMBS_UP")}
    if ev_type == EventsItems.VOICE.value:
        return {"condition": "voice",
                "value": condition_block.get("fields", {}).get("VOICE_WORD", "YES")}
    if ev_type == EventsItems.FIND.value:
        try:
            obj_data = loads(condition_block["inputs"]["OBJECT"]["block"]["data"])
            return {"condition": "object", "value": obj_data.get("name", "")}
        except (KeyError, TypeError, ValueError):
            return None
    if ev_type == EventsItems.HUMAN_FEEDBACK.value:
        return {"condition": "human_feedback", "value": ""}
    return None


def _notify_condition_wait_start(condition_block: dict, simulate_event: bool):
    """Tell the frontend a bare `when`/`repeat_until` condition wait is
    starting — without this, only human_action blocks (which already wrap
    _eval_condition_tree with their own human-step-start/-complete) drove the
    countdown/self-view UI and the STATUS line; a bare `when(gesture, ...)`
    left the operator's webcam running with nothing shown and no feedback
    for the whole timeout (confirmed live, 2026-07-30 — the browser camera
    turned on but the panel showed nothing, and the STATUS line never left
    "Starting simulation"). Best-effort, like every other bridge notify here.

    No-op in auto mode (simulate_event=True): _resolve_condition routes that
    straight to _log_condition, which resolves synchronously with no real
    wait — sending 'started' there with no guaranteed matching 'complete'
    (skipped below whenever fulfilled comes back False) would leave the
    frontend's human-step UI stuck showing a wait that isn't happening.
    """
    if simulate_event:
        return
    payload = _condition_step_payload(condition_block)
    if payload is None:
        return
    try:
        _bridge.notify(
            "/api/human-step-start",
            {**payload, "description": "", "timeout": CONDITION_TIMEOUT_S},
        )
    except Exception:
        pass


def _notify_condition_wait_complete(condition_block: dict, simulate_event: bool):
    """Pair of _notify_condition_wait_start — only sent when a 'start' was
    actually sent for this block (same simulate_event/compound-condition
    gate), so a skipped 'start' never gets an unpaired 'complete'."""
    if simulate_event or _condition_step_payload(condition_block) is None:
        return
    try:
        _bridge.notify("/api/human-step-complete")
    except Exception:
        pass


def _eval_condition_tree(block: dict, simulate_event: bool) -> bool:
    """Evaluate a condition block tree, handling AND/OR/NOT recursively.

    AND/OR/NOT blocks route to child branches; leaf blocks fall through to
    _resolve_condition (gesture, find_object, timer, etc.). A missing/
    unattached operand anywhere in the tree makes the whole guard
    unusable: it always evaluates to False, regardless of the operator or
    of what the other operand evaluates to. Without this, an empty OR/AND
    slot could still let the surviving branch (or, under NOT, the absence
    itself) look "satisfied" and run a robot action on an incomplete
    guard — same rule _h_when/_h_repeat_until already apply at entry, but
    it must also hold one level down, inside the AND/OR/NOT recursion
    itself, since a shadow slot can be left empty at any depth of the tree.
    """
    if block is None:
        return False

    btype = block.get("type", "")
    inputs = block.get("inputs", {})

    if btype == BooleanItems.AND.value:
        a_block = inputs.get("A", {}).get("block")
        b_block = inputs.get("B", {}).get("block")
        if a_block is None or b_block is None:
            return False
        return _eval_condition_tree(a_block, simulate_event) and _eval_condition_tree(b_block, simulate_event)

    if btype == BooleanItems.OR.value:
        a_block = inputs.get("A", {}).get("block")
        b_block = inputs.get("B", {}).get("block")
        if a_block is None or b_block is None:
            return False
        return _eval_condition_tree(a_block, simulate_event) or _eval_condition_tree(b_block, simulate_event)

    if btype == BooleanItems.NOT.value:
        bool_block = inputs.get("BOOL", {}).get("block")
        if bool_block is None:
            return False
        return not _eval_condition_tree(bool_block, simulate_event)

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
#
# A Saved Task is the exception to that rule, and included on purpose. The
# reason containers are excluded is that their children are on the canvas: the
# inner block lights up, so the operator can see where the run is. A macro's
# children live in ANOTHER task's workspace and are not displayed at all, so
# excluding it left nothing highlighted for the whole time the sub-program ran
# — the canvas looked idle while the robot moved. The inner blocks still emit
# their own events; those ids are not on this canvas and highlightExecutingBlock
# no-ops on a block it cannot find, so they cost nothing.
HIGHLIGHTABLE_BLOCKS = {
    StepsItems.PICK.value, StepsItems.PLACE.value, StepsItems.PROCESSING.value,
    StepsItems.MOVE_TO.value, StepsItems.GRIPPER.value, StepsItems.OPEN_GRIPPER.value,
    StepsItems.CLOSE_GRIPPER.value, StepsItems.WAIT.value,
    StepsItems.HUMAN_ACTION.value, StepsItems.NOTIFY_ACTION.value,
    MacroItems.MACRO_TASK.value,
}


def _notify_block_step(block_id, block_type, phase, **extra):
    """Fire-and-forget block-execution highlight event (non-fatal).

    `extra` carries optional per-block detail (currently the Saved Task progress
    fields) on the same channel rather than a second event type: the frontend
    already re-highlights on every 'start' for the same id, so re-announcing a
    block with new detail costs one redundant class toggle.

    It is NOT free of plumbing, despite riding an existing channel: the Flask
    bridge rebuilds this payload field by field (`/block-step` in
    blueprints/flask_api.py), so a key not named there is dropped in transit
    with no error at either end. Adding a field here means adding it there too,
    and rebuilding the ROS package — which is exactly how the macro progress
    fields came to be sent by the backend and never seen by the browser.
    """
    try:
        _bridge.notify("/api/block-step", {
            "kind": "block",
            "blockId": block_id,
            "blockType": block_type,
            "phase": phase,
            **extra,
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
    _macro_depth: int = 0,
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
                    simulate_event, inside_conditional, _macro_depth,
                )

        def _recurse(input_name: str):
            """Recurse into a named statement-input block."""
            blk = code.get("inputs", {}).get(input_name, {}).get("block")
            if blk:
                simulation_recursive_blockly_parser(
                    blk, objectsOfUser, actionsOfUser, locationsOfUser,
                    simulate_event, inside_conditional=True, _macro_depth=_macro_depth,
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
            try:
                times = int(code["fields"]["times"])
            except (KeyError, TypeError, ValueError) as exc:
                print(f"[ERROR] Repeat: invalid/missing 'times' field, skipping loop entirely: {exc}")
                times = 0
            if times > MAX_LOOP_ITERATIONS:
                # Unlike repeat_until, this field is a fixed count with no
                # other backstop — a bad/huge value would otherwise run
                # until the operator noticed and pressed Stop.
                print(f"[WARNING] Repeat: {times} exceeds MAX_LOOP_ITERATIONS "
                      f"({MAX_LOOP_ITERATIONS}) — capping")
                times = MAX_LOOP_ITERATIONS
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
            if not condition_block:
                # Mirror _h_when: an unattached exit condition must never let a
                # robot action run — skip the loop entirely instead of treating
                # the absent guard as trivially satisfied after one iteration.
                # Running DO once unconditionally would be the exact opposite
                # of WHEN's "no condition = never run" rule for the same
                # reachable case (condition: null passes chat.py validation).
                print("[WARNING] Repeat-Until: no condition attached — skipping loop entirely")
                _next()
                return
            _fulfilled = False
            for i in range(MAX_LOOP_ITERATIONS):
                if SIMULATION_STOP_EVENT.is_set():
                    break
                print(f"[LOGIC]   repeat-until iteration {i + 1}/{MAX_LOOP_ITERATIONS}")
                _recurse("DO")
                if _condition_contains_find(condition_block):
                    _move_to_scan_pose()
                _notify_condition_wait_start(condition_block, simulate_event)
                _fulfilled = _eval_condition_tree(condition_block, simulate_event)
                if _fulfilled:
                    _notify_condition_wait_complete(condition_block, simulate_event)
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
            # An unattached WHEN condition serializes as {} (no "block" key) —
            # reachable from a real, isValid:true chat proposal (condition:
            # null passes chat.py validation) or a hand-built block with an
            # empty shadow slot. Treat "no condition" as "not fulfilled", not
            # a crash: an ambiguous/incomplete guard must never let a robot
            # action run — a raised KeyError here would otherwise be
            # swallowed by the parser's blanket except, silently truncating
            # every step after this one while the run still reported success.
            condition_block = code.get("inputs", {}).get("WHEN", {}).get("block")
            fulfilled = False
            if condition_block:
                if _condition_contains_find(condition_block):
                    _move_to_scan_pose()
                _notify_condition_wait_start(condition_block, simulate_event)
                fulfilled = _eval_condition_tree(condition_block, simulate_event)
                if fulfilled:
                    _notify_condition_wait_complete(condition_block, simulate_event)
            if fulfilled:
                _recurse("DO")
                _interruptible_sleep(3)
            _next()

        def _h_when_otherwise():
            condition_block = code.get("inputs", {}).get("WHEN", {}).get("block")
            fulfilled = False
            if condition_block:
                if _condition_contains_find(condition_block):
                    _move_to_scan_pose()
                _notify_condition_wait_start(condition_block, simulate_event)
                fulfilled = _eval_condition_tree(condition_block, simulate_event)
                if fulfilled:
                    _notify_condition_wait_complete(condition_block, simulate_event)
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
            # Must be the same constant _wait_for_condition() enforces: this
            # value drives the operator's on-screen countdown, and a literal
            # here meant the ring counted down from 60 while the deadline fired
            # at 30 — the step looked like it still had half a minute left at
            # the moment it gave up.
            step_start_payload = {"description": task_desc, "timeout": CONDITION_TIMEOUT_S}
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
                elif ev_type == EventsItems.HUMAN_FEEDBACK.value:
                    step_start_payload["condition"] = "human_feedback"
                # Drain the relevant cache BEFORE the human-step-start notify
                # goes out, not after. _wait_for_condition() below resets
                # again at its own entry, but that happens only once the
                # notify has already been sent to the operator's browser —
                # a press/utterance landing in that gap would be recorded
                # then immediately wiped, and silently lost.
                if ev_type == EventsItems.VOICE.value:
                    from backend.functions.vision_live import reset_voice
                    reset_voice()
                elif ev_type == EventsItems.HUMAN_FEEDBACK.value:
                    from backend.functions.vision_live import reset_confirm
                    reset_confirm()
                # Travel to the scan pose BEFORE the countdown starts. This
                # move only happens for find-object confirms, so leaving it
                # after the notify charged that channel — and only that
                # channel — several seconds of arm travel as if it were
                # operator response time, which makes the four confirmation
                # channels incomparable on duration.
                if _condition_contains_find(confirm_event):
                    _move_to_scan_pose()
            try:
                _bridge.notify("/api/human-step-start", step_start_payload)
            except Exception:
                pass
            # Logged after the scan-pose move and immediately before the wait,
            # so the interval to step_end is operator response time and nothing
            # else. simulate_event is recorded because in that mode the
            # condition is short-circuited: without it, an auto-completed run
            # is indistinguishable in the log from a confirmed one.
            study_log.log_event(
                "human_step_start",
                description=task_desc,
                condition=step_start_payload.get("condition"),
                value=step_start_payload.get("value"),
                timeout_s=CONDITION_TIMEOUT_S,
                simulate_event=simulate_event,
            )
            if confirm_event:
                # The return value must be checked, not discarded — a confirm
                # that timed out (or a malformed nested AND/OR confirm) would
                # otherwise still notify human-step-complete and let the task
                # proceed, the exact failure a human confirm step exists to
                # prevent (e.g. placing a never-verified item).
                _take_condition_bypass()  # clear anything left by an earlier step
                confirmed = _eval_condition_tree(confirm_event, simulate_event)
                bypass = _take_condition_bypass()
                if not confirmed:
                    # "timeout" used to cover three different things: a real
                    # timeout, an operator Stop, and a STRICT_CONDITIONS abort
                    # on an unreachable camera. They mean opposite things in
                    # the analysis — a Stop is not a failure of the channel —
                    # and the study log had no way to tell them apart.
                    study_log.log_event(
                        "human_step_end",
                        description=task_desc,
                        condition=step_start_payload.get("condition"),
                        outcome=(
                            "stopped" if SIMULATION_STOP_EVENT.is_set() else "timeout"
                        ),
                    )
                    _abort_task(
                        "The task stopped because the operator didn't confirm in time.",
                        detail=f"human_action confirm not received in time for '{task_desc}'",
                    )
                    return
            try:
                _bridge.notify("/api/human-step-complete")
            except Exception:
                pass
            # A bypass resolved this step without the operator doing anything.
            # Recorded as its own outcome, with the reason: a fabricated
            # confirmation that reads as "confirmed" is worse than a missing
            # one, because nothing downstream can filter it out.
            study_log.log_event(
                "human_step_end",
                description=task_desc,
                condition=step_start_payload.get("condition"),
                outcome="bypassed" if bypass else "confirmed",
                **({"bypass_reason": bypass} if bypass else {}),
            )
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
            obj = objectsOfUser.filter(id=object_data.get("id")).first()
            sdf_name = obj.name if obj else object_data.get("name", "unknown")
            safe_sdf_name = _safe_gz_entity_name(sdf_name)
            if safe_sdf_name is None:
                _abort_task(
                    f"Can't pick up '{sdf_name}' — its name isn't valid for the simulator.",
                    detail=f"PICK: object name '{sdf_name}' rejected by _safe_gz_entity_name",
                )
                return
            print(f"[ROBOT] PICK: {sdf_name}")
            _, _, obj_min_z = get_sdf_dimensions(safe_sdf_name)
            # Objects too wide for a rack slot rest on top of the rack, not in
            # it — spawning them at slot coordinates without this lift buries
            # them in the (now static) rack walls. Same lift is applied to the
            # grasp height and the pick snap, see rack_lift_for_width.
            z_rest = (TABLE_TOP_Z_ABS - obj_min_z
                      + rack_lift_for_width(normalize_object_for_grasp(safe_sdf_name).graspable_width))

            # Pick source is always the tube rack — cycle its slots
            # (PICK_RACK_PROFILE["slot_xy_offsets"], separate from the place
            # rack's LOCATION_PROFILES entry: on the real cell the two are
            # approached from different headings and do NOT share offsets),
            # so consecutive picks in one run take from different holes.
            pick_grasp_yaw = None
            # Arm IK target — profile-aware (DEFAULT_PICK_X_REL/Y_REL switches
            # sim vs real-cell calibration, see calibration.py). Deliberately
            # NOT derived from spawn_x/spawn_y below: those are Gazebo-world
            # coordinates for the twin's visual object only. Before this fix,
            # pick_x_rel/pick_y_rel were computed as spawn_x/y - ROBOT_BASE_X/Y
            # (module-level constants here, never switched by DRIVE_HARDWARE),
            # which silently ignored a real-cell recalibration of
            # DEFAULT_PICK_X_REL/Y_REL — confirmed on physical hardware
            # 2026-07-29 (calibrate_rack.py's calibrated target vs. the arm's
            # actual pick point differed by ~17mm). In the sim profile these
            # coincide exactly by construction (OBJECT_SPAWN_X/Y - ROBOT_BASE_X/Y
            # == _SIM_PROFILE's DEFAULT_PICK_X_REL/Y_REL), so this changes
            # nothing in Gazebo-only runs — only real hardware now reaches the
            # calibrated point.
            pick_x_rel, pick_y_rel = DEFAULT_PICK_X_REL, DEFAULT_PICK_Y_REL
            spawn_x, spawn_y = OBJECT_SPAWN_X, OBJECT_SPAWN_Y
            rack_cfg = PICK_RACK_PROFILE
            if rack_cfg:
                slot_idx = getattr(simulation_recursive_blockly_parser, "pick_slot_index", 0)
                offsets = rack_cfg["slot_xy_offsets"]
                if slot_idx >= len(offsets):
                    # Same silent-wrap concern as the place side: worth a
                    # loud warning rather than only the quiet per-slot log.
                    print(f"[WARNING] PICK: slot index {slot_idx} exceeds the "
                          f"{len(offsets)} configured rack slot(s) — wrapping to slot "
                          f"{slot_idx % len(offsets)}, which may already be empty/depleted.")
                dx, dy = offsets[slot_idx % len(offsets)]
                spawn_x = OBJECT_SPAWN_X + dx
                spawn_y = OBJECT_SPAWN_Y + dy
                pick_x_rel = DEFAULT_PICK_X_REL + dx
                pick_y_rel = DEFAULT_PICK_Y_REL + dy
                pick_grasp_yaw = rack_cfg.get("grasp_yaw", 0.0)
                simulation_recursive_blockly_parser.pick_slot_index = slot_idx + 1
                print(f"[SIMULATOR] Pick slot {slot_idx % len(offsets)}: spawn_x={spawn_x:.3f} spawn_y={spawn_y:.3f} yaw={pick_grasp_yaw:.3f}")

            cmd = (
                'gz service -s /world/worldCobotta/create '
                '--reqtype gz.msgs.EntityFactory --reptype gz.msgs.Boolean '
                '--timeout 5000 --req \'name: "object"; '
                f'sdf_filename: "{os.path.join(BASE_DIR, "ros2_ws", "Cobotta", "objects", safe_sdf_name, "model.sdf")}"; '
                f'pose: {{position: {{x: {spawn_x}, y: {spawn_y}, z: {z_rest}}}, '
                'orientation: {x: 0, y: 0, z: 0, w: 1}}\''
            )
            spawn_ok = launch_wsl_ros_command(cmd, expect_reply_true=True)
            if not spawn_ok:
                # Used to be a warning that let the pick continue with the
                # attach skipped — the arm then closed on empty space (or,
                # on hardware, on a real object the twin never showed),
                # and a later gate aborted with an unrelated diagnosis.
                # Same "never fake a success" rule as every other gate here.
                _abort_task(
                    f"Couldn't pick up '{sdf_name}' — it didn't spawn in the simulator.",
                    detail=f"object spawn failed for '{sdf_name}' (gz create returned false)",
                )
                return
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
            if set_object_world_pose(spawn_x, spawn_y, z_rest, yaw=0.0):
                print(f"[GRASP] hold confirmed: upright at rest "
                      f"({spawn_x},{spawn_y},z={z_rest:.4f})")
            else:
                _abort_task(
                    f"Couldn't pick up '{sdf_name}' — it wasn't resting stably where expected.",
                    detail=f"post-spawn hold failed for '{sdf_name}' (set_pose) — "
                           "refusing to pick an unstable/unheld object",
                )
                return
            _interruptible_sleep(0.3)
            simulation_recursive_blockly_parser.last_picked_object = sdf_name
            simulate_ros_pick(obj, sdf_name, do_attach=True,
                              pick_x_rel=pick_x_rel, pick_y_rel=pick_y_rel,
                              obj_min_z=obj_min_z, grasp_yaw_override=pick_grasp_yaw)
            _next()

        def _h_place():
            location_data = _safe_block_data("LOCATION", "PLACE")
            if location_data is None:
                _next()
                return
            location = locationsOfUser.filter(id=location_data.get("id")).first()
            sdf_name = location.name if location else location_data.get("name", "unknown")
            safe_loc_sdf_name = _safe_gz_entity_name(sdf_name)
            if safe_loc_sdf_name is None:
                _abort_task(
                    f"Can't place at '{sdf_name}' — its name isn't valid for the simulator.",
                    detail=f"PLACE: location name '{sdf_name}' rejected by _safe_gz_entity_name",
                )
                return
            print(f"[ROBOT] PLACE: {sdf_name}")
            # Respawn the destination only when it actually changes. Placing
            # three tubes into the same cup used to delete and recreate that
            # cup three times, and every recreate is a window in which anything
            # resting in it falls. Same destination twice in a row: leave the
            # one that is already there, holding what is already in it.
            global _spawned_location_name
            if _spawned_location_name == safe_loc_sdf_name:
                print(f"[SIMULATOR] Location '{sdf_name}' already in world — reusing")
                picked_obj_name = getattr(
                    simulation_recursive_blockly_parser, "last_picked_object", "flask")
                simulate_ros_place(picked_obj_name, objectsOfUser, sdf_name)
                _interruptible_sleep(1)
                _next()
                return
            # Different destination (or none yet). Take the outgoing
            # container's contents with it: those are independent top-level
            # models resting ON it, not children of it, so removing the
            # container alone would drop them onto the bench — which is what an
            # operator saw as tubes tumbling across the table for no visible
            # reason. Before the removal, so nothing is ever unsupported.
            if _spawned_location_name:
                _delete_placed_objects(location=_spawned_location_name)
            if not remove_entity_and_wait("location"):
                _abort_task(
                    f"Couldn't place at '{sdf_name}' — the previous destination "
                    "is still in the simulator.",
                    detail="location removal did not complete; refusing to spawn over it",
                )
                return
            _spawned_location_name = None
            loc_cmd = (
                'gz service -s /world/worldCobotta/create '
                '--reqtype gz.msgs.EntityFactory --reptype gz.msgs.Boolean '
                '--timeout 5000 --req \'name: "location"; '
                f'sdf_filename: "{os.path.join(BASE_DIR, "ros2_ws", "Cobotta", "locations", safe_loc_sdf_name, "model.sdf")}"; '
                f'pose: {{position: {{x: {LOCATION_SPAWN_X}, y: {LOCATION_SPAWN_Y}, z: {TABLE_TOP_Z_ABS}}}, '
                'orientation: {x: 0, y: 0, z: 0.7071, w: 0.7071}}\''
            )
            if not launch_wsl_ros_command(loc_cmd, expect_reply_true=True):
                # The snap-to-slot hard gate in simulate_ros_place (below)
                # teleports the object to this location's coordinates — if
                # the location itself never spawned, that gate would place
                # the object at a target that doesn't exist in the world.
                # Same "never fake a success" rule, one step earlier.
                _abort_task(
                    f"Couldn't place '{sdf_name}' — the destination location wasn't ready.",
                    detail=f"location spawn failed for '{sdf_name}' target",
                )
                return
            _spawned_location_name = safe_loc_sdf_name
            picked_obj_name = getattr(simulation_recursive_blockly_parser, "last_picked_object", "flask")
            simulate_ros_place(picked_obj_name, objectsOfUser, sdf_name)
            _interruptible_sleep(1)
            _next()

        def _h_processing():
            action_data = _safe_block_data("ACTION", "PROCESSING")
            if action_data is None:
                _next()
                return
            action = actionsOfUser.filter(id=action_data.get("id")).first()
            action_name = action.name if action else action_data.get("name", "unknown")
            print(f"[ROBOT] PROCESSING action: {action_name}")
            if action and action.points:
                try:
                    action_points = loads(action.points).get("points", [])
                except Exception as e:
                    # Bad JSON in the DB must abort, not silently continue
                    # as if the skill had run. simulate_ros_action already
                    # aborts on a playback failure; this is the same rule
                    # one step earlier, for a payload it can't even parse.
                    _abort_task(
                        f"Couldn't run the skill '{action_name}' — its saved motion looks corrupted.",
                        detail=f"Action.points JSON parse failed: {e}",
                    )
                    return
                simulate_ros_action(action_points)
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
                    # MOVE_TO is an arm command, not a gripper command — carry
                    # the current aperture through to both sim and hardware
                    # instead of guessing (a mismatch here would leave the
                    # gripper open on hardware and closed on the twin, or
                    # vice versa).
                    _, current_hand = get_current_state()
                    if not simulate_ros_move(
                        pos["j1"], pos["j2"], pos["j3"],
                        pos["j4"], pos["j5"], pos["j6"],
                        current_hand,
                    ):
                        return
                    _send_hw_target(target_q, current_hand)
                    set_current_state(target_q, current_hand)
                    moved = True

            if not moved:
                print(f"[ROBOT]   No joint data in DB for '{location_name}' → using default intermediate position")
                _, current_hand = get_current_state()
                if not simulate_ros_move(*SAFE_INTERMEDIATE_POSE, current_hand):
                    return
                _send_hw_target(list(SAFE_INTERMEDIATE_POSE), current_hand)
                set_current_state(list(SAFE_INTERMEDIATE_POSE), current_hand)

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
            # Gripper-only command — keep the arm where it currently is.
            # Flying the sim arm to a hardcoded home pose here instead would
            # diverge from the real arm, which stays put, a full-pose
            # mismatch mid-carry.
            current_joints, _ = get_current_state()
            if not simulate_ros_move(*current_joints, hand_value):
                return
            set_current_state(current_joints, hand_value)
            _send_hw_target([], hand_value, hand_only=True)
            _interruptible_sleep(1)
            _next()

        def _h_open_gripper():
            print("[ROBOT] Opening gripper")
            current_joints, _ = get_current_state()
            if not simulate_ros_move(*current_joints, ROS_OPEN_GRIPPER):
                return
            set_current_state(current_joints, ROS_OPEN_GRIPPER)
            _send_hw_target([], ROS_OPEN_GRIPPER, hand_only=True)
            _interruptible_sleep(1)
            _next()

        def _h_close_gripper():
            print("[ROBOT] Closing gripper")
            current_joints, _ = get_current_state()
            if not simulate_ros_move(*current_joints, ROS_CLOSE_GRIPPER_WITH_OBJECT):
                return
            set_current_state(current_joints, ROS_CLOSE_GRIPPER_WITH_OBJECT)
            _send_hw_target([], ROS_CLOSE_GRIPPER_WITH_OBJECT, hand_only=True)
            _interruptible_sleep(1)
            _next()

        def _h_wait():
            try:
                seconds = int(code.get("fields", {}).get("SECONDS", 1))
            except (TypeError, ValueError):
                seconds = 1
            print(f"[ROBOT] Wait {seconds}s (interruptible)")
            _interruptible_sleep(seconds)
            _next()

        # ══════════════════════════════════════════════════════════════════════
        # MACRO TASKS
        # ══════════════════════════════════════════════════════════════════════

        def _h_macro():
            try:
                macro_data = loads(code["data"])
                macro_id = macro_data["id"]
            except (KeyError, TypeError, ValueError) as exc:
                print(f"[ERROR] MACRO: malformed/missing block data, skipping: {exc}")
                _next()
                return
            macro_name = macro_data.get("name", str(macro_id))
            if _macro_depth >= MAX_MACRO_DEPTH:
                print(f"[MACRO] ABORT: recursion depth {_macro_depth} exceeded "
                      f"MAX_MACRO_DEPTH={MAX_MACRO_DEPTH} at '{macro_name}' — likely a macro cycle")
                _abort_task(
                    f"'{macro_name}' didn't finish — too many nested saved tasks (possible loop). "
                    "Check this saved task for a step that refers back to itself.",
                    detail=f"macro recursion depth {_macro_depth} exceeded MAX_MACRO_DEPTH={MAX_MACRO_DEPTH}",
                )
                return
            print(f"[MACRO] Starting macro: {macro_name}")
            # Owner-or-shared, same visibility rule simulate_task() applies to
            # the top-level task — an arbitrary macro id must not reach
            # another user's private task.
            macro_task = Task.objects.filter(
                Q(owner=_RUN_OWNER_ID) | Q(shared=True), id=macro_id
            ).first()
            # Task.code is the LEGACY column: nothing has written it since the
            # lifecycle migration (publish_task/save_draft write only
            # published_workspace/draft_workspace, and libraries.py creates
            # tasks without it — "code" there is the name of an API response
            # field, not the column). Reading it meant every Saved Task block
            # resolved to None, skipped its whole sub-program, and still
            # printed "Macro complete" — a claim the run result then repeated
            # as success. _resolve_runtime_workspace is the read path the rest
            # of the codebase uses, and for a macro it returns the PUBLISHED
            # workspace only: a Saved Task must run what its author published,
            # never their work in progress.
            macro_workspace = (
                _resolve_runtime_workspace(macro_task) if macro_task else None
            )
            if macro_workspace:
                # A published workspace is the flat array of top-level blocks
                # (getBlocklyStructure returns `.blocks.blocks`), while the
                # parser takes ONE block. simulate_task unwraps that list at the
                # top level; this branch did not, so every macro run died on
                # `code["type"]` with "list indices must be integers". Same
                # shape as the legacy-column bug above: the read path was fixed
                # without matching the shape it now returns.
                blocks = (
                    macro_workspace
                    if isinstance(macro_workspace, list)
                    else [macro_workspace]
                )
                # Progress for the Saved Task, announced on the macro's own
                # block. Its inner blocks live in another task's workspace and
                # are not on this canvas, so without this the operator watches
                # one block glow for the whole sub-program with no way to tell
                # what it is doing or how far along it is — the one place in a
                # run where the canvas cannot answer that by itself.
                #
                # The chain is flattened here rather than counting the entries
                # of `blocks`: in Blockly a connected sequence is ONE top-level
                # block with the rest hanging off `next`, so a three-step macro
                # arrives as a single root and reported "step 1 of 1".
                #
                # `when_start` is walked but not counted — it is the editor's
                # start marker, not something the author put in the program
                # (analisi.py excludes it from block counts for the same
                # reason).
                #
                # Reported as "step N of M", never a percentage: M counts the
                # chain, while a `repeat 5 times` inside it executes its body
                # five times. "the 3rd of the 4 things this saved task does"
                # stays true whatever those things expand to at runtime.
                chain = []
                for root in blocks:
                    node = root
                    while isinstance(node, dict):
                        chain.append(node)
                        node = (node.get("next") or {}).get("block")

                macro_total = sum(1 for b in chain if b.get("type") != WHEN_START)
                own_id = code.get("id")
                macro_index = 0
                for chain_block in chain:
                    if chain_block.get("type") != WHEN_START:
                        macro_index += 1
                        # Depth guard for the same reason as the wrapper above:
                        # a macro nested inside a macro is not on this canvas
                        # either, and its progress would hijack the line the
                        # outer one is using.
                        if own_id and _macro_depth == 0:
                            _notify_block_step(
                                own_id, block_type, "start",
                                macroName=macro_name,
                                macroStep=macro_index,
                                macroTotal=macro_total,
                            )
                    # `next` is stripped so the parser runs THIS block only —
                    # the chain is being walked here, and letting _next() follow
                    # it too would execute every remaining step once per step.
                    single = {k: v for k, v in chain_block.items() if k != "next"}
                    simulation_recursive_blockly_parser(
                        single,
                        objectsOfUser, actionsOfUser, locationsOfUser,
                        simulate_event, inside_conditional, _macro_depth + 1,
                    )
                    # Stop at the first failure instead of running the rest of
                    # the macro's blocks against an already-aborted run.
                    if _TASK_ABORT_REASON or SIMULATION_STOP_EVENT.is_set():
                        break

                # "Macro complete" must not be printed over a macro that
                # aborted: the log then claims the sub-program ran while the
                # run result says it failed, which is what made the original
                # silent-skip bug so hard to see.
                if _TASK_ABORT_REASON or SIMULATION_STOP_EVENT.is_set():
                    print(f"[MACRO] Macro stopped before finishing: {macro_name}")
                    return
                print(f"[MACRO] Macro complete: {macro_name}")

                # Close the Saved Task BEFORE continuing the chain.
                #
                # Every handler calls _next() from inside itself, so the rest of
                # the program runs nested within this call and the wrapper's own
                # "end" for this block does not fire until the whole run is
                # over. For an ordinary block that is invisible — the next
                # block's "start" replaces its highlight. For a macro it is not:
                # the frontend pins the highlight and the STATUS line to the
                # macro while its context is open, precisely so the macro's
                # inner blocks cannot steal them, so without this the run
                # finished with the macro still lit and stuck on its last step.
                #
                # The wrapper still emits its own "end" later; clearing an
                # already-cleared context is a no-op.
                if own_id and _macro_depth == 0:
                    _notify_block_step(own_id, block_type, "end")

                _next()
                return

            # Nothing to run. Aborting rather than continuing: the operator put
            # this block in the program deliberately, and skipping it silently
            # produces a run that reports success while doing less than the
            # program says — the same failure the pick/place gates exist to
            # prevent. A deleted or never-published macro is exactly the case
            # CLAUDE.md flags as unprotected at publish time.
            #
            # Two causes, two remedies, and they were sharing one sentence.
            # The print already said "not found OR has no published version";
            # the operator's message only ever said the second. Observed on
            # 2026-09-02: a Saved Task block held id 101, a task deleted and
            # later recreated as id 130, and the run told the operator to go
            # publish a task that was already published. They opened it, saw
            # "published", and had nowhere to go — the message named a remedy
            # that could not work, for a fault it had not diagnosed.
            #
            # A dangling id is NOT resolved by falling back to the name stored
            # alongside it. The name matched here, case aside, and matching it
            # would have run the recreated task — but "the reference is stale,
            # so use whatever is called something similar" is how a robot ends
            # up running a program its author did not choose. Say what is
            # wrong; let the author re-pick.
            if macro_task is None:
                print(f"[MACRO] ABORT: macro id {macro_id} ('{macro_name}') not found "
                      f"for owner {_RUN_OWNER_ID} (deleted, or not shared with them)")
                _abort_task(
                    f"This task uses a saved task called '{macro_name}', but that "
                    f"saved task no longer exists — it was probably deleted and "
                    f"recreated, which gives it a new identity even under the same "
                    f"name. Open this task, delete the '{macro_name}' block and add "
                    f"it again from Saved Tasks.",
                    detail=f"macro id {macro_id} ('{macro_name}') resolves to no task "
                           f"visible to owner {_RUN_OWNER_ID}",
                )
                return

            print(f"[MACRO] ABORT: macro {macro_id} ('{macro_name}') exists but has "
                  f"no published workspace (status={macro_task.status})")
            _abort_task(
                f"'{macro_name}' couldn't run — that saved task has no published "
                f"version. Open it, publish it, then run this task again.",
                detail=f"macro {macro_id} ('{macro_name}'): status="
                       f"{macro_task.status}, no published workspace",
            )

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
            WHEN_START: _h_when_start,
        }

        handler = BLOCK_HANDLERS.get(block_type)
        if handler is not None:
            block_id = code.get("id")
            # Only blocks on the operator's own canvas are announced.
            #
            # A Saved Task executes blocks belonging to ANOTHER task's
            # workspace: their ids are not on this canvas, so highlighting them
            # is a no-op, but they were still counted, and a 3-step macro made
            # the run-wide "N done" jump by four on a canvas holding three
            # blocks. The macro reports its own progress separately, which is
            # the honest way to describe a sub-program: as one step of this
            # program that is N steps into itself. Fewer events also matters on
            # the polling transport, where a burst collapses to its last event.
            emit_highlight = (
                bool(block_id)
                and block_type in HIGHLIGHTABLE_BLOCKS
                and _macro_depth == 0
            )
            # The macro owns its own "end": it fires when the sub-program
            # finishes, whereas the wrapper's `finally` below only runs after
            # _next() has taken the whole rest of the program with it. Letting
            # both through counted the macro twice.
            emit_end = emit_highlight and block_type != MacroItems.MACRO_TASK.value
            if emit_highlight:
                _notify_block_step(block_id, block_type, "start")
            try:
                handler()
            finally:
                # In a finally so a handler that raises still clears its
                # highlight. Without it the "end" event is skipped and the block
                # keeps glowing after the run has aborted — the canvas showing a
                # step still in progress while the run reports failure. Harmless
                # to miss on a fast leaf block, much less so on a Saved Task,
                # which now highlights for as long as its whole sub-program runs.
                if emit_end:
                    _notify_block_step(block_id, block_type, "end")
        else:
            print(f"[WARNING] Block type unknown or ignored: {block_type}")

    except Exception as e:
        # Any handler bug hard-aborts here instead of masquerading as a
        # clean run — a bare print would let the chain silently truncate
        # while simulate_task() still reports success_response() because
        # _TASK_ABORT_REASON stays None. block_type may not have been
        # assigned yet if `code` itself was malformed, hence the safe lookup.
        safe_block_type = code.get("type", "unknown") if isinstance(code, dict) else "unknown"
        logger.exception("parser_handler_exception", extra={"block_type": safe_block_type})
        _abort_task(
            "The task stopped unexpectedly — check the server log for details.",
            detail=f"simulation_recursive_blockly_parser: block_type={safe_block_type}: {e}",
        )


def simulate_task(request: HttpRequest) -> HttpResponse:
    global _TASK_ABORT_REASON, _HW_DRIVE_REQUESTED, _RUN_OWNER_ID
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
                # Claim a generation before touching the world: from here on,
                # any teardown still in flight from the previous run or its
                # Stop belongs to an older one and will skip itself.
                run_generation = _begin_run_generation()
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
                    _RUN_OWNER_ID = request.user.id
                    from backend.functions.vision_live import reset_voice, reset_confirm
                    reset_voice()  # drop any word heard before this run started
                    reset_confirm()  # drop any confirm press from before this run started
                    _set_world_paused(False)
                    reset_simulation_world()

                    # Delimits the run in the study log. Without it the human-step
                    # events in a session are one flat stream with no way to tell
                    # which task produced them, and time-per-task has to be read
                    # off the screen recording by hand.
                    #
                    # Logged only after every guard above has passed, so a refused
                    # run never opens an interval that no run_end closes.
                    study_log.log_event(
                        "run_start",
                        task_id=task.id,
                        task_name=task.name,
                        target="real" if drive_hardware else "sim",
                        simulate_event=bool(simulate_event),
                        user=request.user.get_username(),
                    )
                    outcome = "error"

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
                            outcome = "aborted"
                            return error_response(f"Task aborted: {_TASK_ABORT_REASON}")
                        if SIMULATION_STOP_EVENT.is_set():
                            # stop_simulation() sets the event but never
                            # _TASK_ABORT_REASON (that field is reserved for
                            # a hard failure) — without this check, an
                            # operator-initiated Stop still reported success.
                            outcome = "stopped"
                            # 409, not 500. Pressing Stop is a normal operator
                            # action, and Django logged every one of them as
                            # "Internal Server Error: /api/task/simulate/" —
                            # red text in the same console where a real fault
                            # has to be spotted. The panel aborts this request
                            # when it sends the Stop, so this response is
                            # normally discarded anyway; the status is for the
                            # log, and the log was calling it a crash.
                            return error_response("Task stopped by operator", status=409)
                        outcome = "completed"
                        return success_response()
                    finally:
                        # In the finally, so a run that raises still closes its
                        # interval — an unclosed run_start would silently drop
                        # that task from the per-task timings.
                        study_log.log_event(
                            "run_end",
                            task_id=task.id,
                            task_name=task.name,
                            outcome=outcome,
                            abort_reason=_TASK_ABORT_REASON,
                        )
                        # Skipped if another run has started since: pausing
                        # then would freeze THAT run's world.
                        if _generation_is_current(run_generation):
                            _set_world_paused(True)
                finally:
                    _HW_DRIVE_REQUESTED = False
                    _RUN_OWNER_ID = None
                    _SIM_RUN_LOCK.release()
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def run_state(request: HttpRequest) -> HttpResponse:
    """Is a run still holding the world?

    Exists so the panel can keep Run disabled until the previous run has
    actually let go, instead of guessing a delay. The teardown is not a fixed
    cost: it can be a `gz` subprocess, a blocking b-CAP move on the real arm,
    or a bridge POST waiting out its own timeout, and "long enough" changes
    with the machine and with what the run was doing when it was stopped.

    `_SIM_RUN_LOCK.locked()` is the honest answer to "can another run start
    right now": it is the exact thing simulate_task tries to acquire, so a
    False here means the next Run will not come back 409.
    """
    if not request.user.is_authenticated:
        return unauthorized_request()
    if request.method != HttpMethod.GET.value:
        return invalid_request_method()
    return success_response({
        "running": _SIM_RUN_LOCK.locked(),
        "generation": _RUN_GENERATION,
    })


def stop_simulation(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.POST.value:
                SIMULATION_STOP_EVENT.set()
                # Claim a generation: this retires the running run, so its own
                # end-of-run pause becomes a no-op instead of landing on
                # whatever starts next.
                stop_generation = _begin_run_generation()
                _spawned_in_world.clear()
                _delete_placed_objects()
                # Three things can go wrong here and only one of them used to
                # be visible: the bridge being unreachable was printed, and the
                # arm refusing to halt was discarded entirely — the response
                # said success either way. That is the single message an
                # operator needs from this endpoint, because the correct action
                # is to reach for the teach-pendant e-stop.
                halt_warning = None
                try:
                    stop_body = _bridge.stop()
                    hardware_halt = (stop_body or {}).get("hardware_halt")
                    # None = no hardware node running; a sim-only stop is the
                    # whole story and nothing needs saying.
                    if hardware_halt is not None and not hardware_halt.get("ok"):
                        halt_warning = (
                            "The simulation stopped, but the robot did not confirm it "
                            "halted — it may still be moving. Use the teach-pendant "
                            "e-stop now."
                        )
                        logger.error(
                            "stop_simulation: hardware halt failed: %s",
                            hardware_halt.get("message"),
                        )
                except Exception as e:
                    print(f"[SIMULATOR] Could not forward stop to Flask bridge: {e}")
                    if _hw_drive_active():
                        halt_warning = (
                            "The simulation stopped, but the stop could not be sent to "
                            "the robot — it may still be moving. Use the teach-pendant "
                            "e-stop now."
                        )
                # Same guard, for the same reason, on the other thread: an
                # operator who stops and immediately restarts would otherwise
                # get a world paused by the PREVIOUS run's Stop, and a new run
                # in which nothing moves and nothing says why.
                if _generation_is_current(stop_generation):
                    _set_world_paused(True)
                if halt_warning:
                    return error_response(halt_warning)
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
