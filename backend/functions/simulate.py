import subprocess
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
from backend.functions.vision_mapping import to_coco_class
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
)

FLASK_BRIDGE_URL = os.getenv("FLASK_BRIDGE_URL", "http://localhost:5000").rstrip("/")

# Shared client for all Flask-ROS bridge calls (centralizes URL + timeouts).
_bridge = FlaskRosClient(FLASK_BRIDGE_URL)

# When set, each key pose is also forwarded to the real arm via /api/move-target.
# cobotta_node must be running with enable_hardware:=true.
# Default off — sim stack unchanged when unset.
DRIVE_HARDWARE = get_bool_env("DRIVE_HARDWARE")
MAX_LOOP_ITERATIONS = int(os.getenv("MAX_LOOP_ITERATIONS", "10"))


def convert_hand_gazebo_cobotta(gazebo_hand_value):
    """Convert a Gazebo gripper joint value (metres, per finger) to the Cobotta
    hand aperture scale (~0-30). The +0.015 m re-centres the Gazebo zero and the
    ×2000 scales metres to the controller's native units."""
    return (gazebo_hand_value + 0.015) * 2000

CURRENT_JOINTS = [0.0, 0.0, 90.0, 0.0, 0.0, 0.0]
CURRENT_HAND = 30.0  # Open gripper
STATE_LOCK = threading.Lock()

# Set by stop_simulation view; checked by the parser and sleep helpers to abort early.
# NOTE: works only with single-process Django (runserver); a multi-process WSGI
# deployment would need shared state (e.g. Redis-backed flag).
SIMULATION_STOP_EVENT = threading.Event()


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
    """Sync joint state from the Flask bridge. Returns True on success, False if state is stale."""
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
    name_to_idx = {'joint1':0, 'joint2':1, 'joint3':2, 'joint4':3, 'joint5':4, 'joint6':5}
    for i, link in enumerate(COBOTTA_CHAIN.links):
        if link.name in name_to_idx:
            joints_full[i] = math.radians(q_deg[name_to_idx[link.name]])
    T = COBOTTA_CHAIN.forward_kinematics(joints_full)
    pos = T[:3, 3]
    # In Gazebo: X = Y_urdf, Y = -X_urdf, Z = Z_urdf - 0.085
    print(f"[{label}] TCP (URDF) x={pos[0]:.3f}, y={pos[1]:.3f}, z={pos[2]:.3f} | (Gazebo) x={pos[1]:.3f}, y={-pos[0]:.3f}, z={pos[2]-URDF_GAZEBO_Z_OFFSET:.3f}")


def get_sdf_dimensions(sdf_name: str, folder: str = "objects"):
    try:
        # Sanitize input to prevent directory traversal
        safe_name = sdf_name.replace(" ", "_").lower()
        sdf_path = os.path.join(BASE_DIR, "ros2_ws", "Cobotta", folder, safe_name, "model.sdf")
        if not os.path.exists(sdf_path):
            return None, None
        
        tree = ET.parse(sdf_path)
        root = tree.getroot()
        collisions = root.findall(".//collision")
        if not collisions:
            return None, None
        
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
                        l = float(length_elem.text.strip())
                        
                        c_min_z = pose_z - l / 2.0
                        c_max_z = pose_z + l / 2.0
                        min_z = min(min_z, c_min_z)
                        max_z = max(max_z, c_max_z)
                        max_width = max(max_width, 2.0 * r)
                        
        if min_z != float('inf') and max_z != float('-inf'):
            return max_z - min_z, max_width
    except Exception as e:
        print(f"[SIMULATOR] Error parsing SDF {sdf_name}: {e}")
    return None, None


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
            print(f"[IK{label}] FK residual pos={pos_err*1000:.1f}mm axis={axis_err:.1f}° — rejected")
            return None, pos_err
        return angles_deg, pos_err
    except Exception as e:
        print(f"[IK{label}] solver exception: {e}")
        return None, float('inf')


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
            for i, link in enumerate(COBOTTA_CHAIN.links):
                if link.name == 'joint1':
                    pos[i] = target_j1
                elif link.name == 'joint2':
                    pos[i] = math.radians(45.0)
                elif link.name == 'joint3':
                    pos[i] = math.radians(70.0)
                elif link.name == 'joint4':
                    pos[i] = 0.0
                elif link.name == 'joint5':
                    pos[i] = math.radians(45.0)
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

    print(f"[SIMULATOR] IK failed all attempts for x={x_rel:.3f} y={y_rel:.3f} z={z_rel:.3f} (last pos_err={err*1000:.1f}mm)")
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
    sdf_height, sdf_width = get_sdf_dimensions(sdf_name)
    
    # Prioritize SDF dimensions as they are the true physical dimensions in Gazebo
    if sdf_height is not None and sdf_height > 0.001:
        height_m = sdf_height
    elif height_m is None or height_m <= 0.001:
        height_m = 0.015 # default pill height (15mm)
        
    if sdf_width is not None and sdf_width > 0.001:
        width_m = sdf_width
    elif width_m is None or width_m <= 0.001 or width_m > 0.03:
        width_m = 0.015 # default width
        
    return height_m, width_m


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
    }
    if not sdf_name:
        return 0.05
    safe_name = os.path.basename(sdf_name)
    sdf_height, _ = get_sdf_dimensions(safe_name, folder="locations")
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
            px, py, pz = 0.0, 0.0, 0.0
            if pose_elem is not None and pose_elem.text:
                parts = pose_elem.text.strip().split()
                if len(parts) >= 3:
                    px, py, pz = float(parts[0]), float(parts[1]), float(parts[2])

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
                l = float(cyl.find("length").text.strip())
                top_z = pz + l / 2.0
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
from backend.block_types import (
    LogicItems,
    StepsItems,
    EventsItems,
    MacroItems,
)
from backend.functions.task import _resolve_runtime_workspace


def launch_wsl_ros_command(command: str) -> bool:
    """Run a shell command. Returns True on success (exit code 0), False otherwise."""
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
        return True
    except Exception as e:
        print(f"[SIMULATOR] launch_wsl_ros_command exception: {e}")
        return False


def _set_world_paused(paused: bool):
    req = "pause: true" if paused else "pause: false"
    cmd = (
        f"gz service -s /world/worldCobotta/control "
        f"--reqtype gz.msgs.WorldControl --reptype gz.msgs.Boolean "
        f"--timeout 3000 --req '{req}'"
    )
    launch_wsl_ros_command(cmd)


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


def _send_hw_target(joints, hand, hand_only=False):
    """Forward one key pose to the real arm via /api/move-target (best-effort, blocking)."""
    if not DRIVE_HARDWARE:
        return
    try:
        payload = {"hand": hand, "hand_only": hand_only}
        if not hand_only:
            j1, j2, j3, j4, j5, j6 = joints
            payload.update({"j1": j1, "j2": j2, "j3": j3, "j4": j4, "j5": j5, "j6": j6})
        _bridge.move_target(payload)
    except Exception as e:
        print(f"[HARDWARE] _send_hw_target failed: {e}")


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


ROS_OPEN_GRIPPER = 30
ROS_GRIPPER_GENTLE_CLOSE = 10
ROS_CLOSE_GRIPPER_WITH_OBJECT = 10  # Default safe close gap (10mm) for generic blocks

CARRY_Z_MIN = 0.15    # minimum carry height above robot base (Gazebo relative, m)
CARRY_MARGIN = 0.03   # safety margin above highest obstacle in workspace

# Max per-joint change (deg) between consecutive IK solutions along a Cartesian
# path. A larger jump signals an elbow flip / singularity, so the path is rejected.
KINEMATIC_JUMP_THRESHOLD_DEG = 30.0

# A flask body is gripped below the cap: lift the pick point by this offset (m)
# above the reference height so the fingers close on the body, not the neck.
FLASK_BODY_PICK_OFFSET_M = 0.024

# Gripper closes this many mm tighter than the object width so the fingers grip
# firmly rather than just touching the surface.
GRIPPER_GRIP_CLEARANCE_MM = 4.0

# DetachableJoint topics (plugin in Cobotta.sdf, parent_link=link_j6, child_model=object)
ATTACH_CMD = "gz topic -t /model/Cobotta/detachable_joint/attach -m gz.msgs.Empty -p 'unused: true'"
DETACH_CMD = "gz topic -t /model/Cobotta/detachable_joint/detach -m gz.msgs.Empty -p 'unused: true'"


def attach_object_to_gripper() -> bool:
    print("[GRASP] Attach: welding 'object' to link_j6 via DetachableJoint")
    ok = launch_wsl_ros_command(ATTACH_CMD)
    if not ok:
        print("[GRASP] WARNING: attach command failed (gz topic returned error)")
    return ok


def detach_object_from_gripper() -> bool:
    print("[GRASP] Detach: releasing 'object' from DetachableJoint weld")
    ok = launch_wsl_ros_command(DETACH_CMD)
    if not ok:
        print("[GRASP] WARNING: detach command failed (gz topic returned error)")
    return ok


# Gazebo world spawn positions (absolute, Gazebo frame)
OBJECT_SPAWN_X = -9.05          # X of object spawn point
OBJECT_SPAWN_Y = -1.48
LOCATION_SPAWN_X = -8.8         # X of location model spawn point
LOCATION_SPAWN_Y = -1.41


def simulate_ros_pick(obj, sdf_name: str = "", do_attach: bool = True):
    try:
        # Sync state from ROS first to anchor the IK seeds. Abort if it fails —
        # planning from a stale seed risks singularities / collisions.
        if not sync_current_state_from_ros():
            print("[ROBOT] PICK aborted: could not sync joint state from ROS")
            return

        # Resolve dimensions
        height_m, width_m = resolve_object_metrics(obj, sdf_name)
        if height_m is None or width_m is None:
            print(f"[ROBOT] PICK aborted: could not resolve dimensions for '{sdf_name}'")
            return
        width_mm = width_m * 1000.0
        
        # Object relative coordinates
        x_rel = DEFAULT_PICK_X_REL
        y_rel = DEFAULT_PICK_Y_REL
        grasp_yaw = getattr(obj, "grasp_yaw", 0.0) or 0.0
        
        # Flask: target sul corpo (sotto il tappo), non sul collo stretto
        if os.path.basename(sdf_name).lower() in {"flask", "blue_cylinder"}:
            z_pick = PICK_Z_REF_OFFSET + FLASK_BODY_PICK_OFFSET_M  # corpo flask: dita afferrano sotto il tappo
        elif height_m > 0.04:
            z_pick = PICK_Z_REF_OFFSET + max(height_m / 2.0, height_m - 0.03)
        else:
            z_pick = PICK_Z_REF_OFFSET + height_m / 2.0

        z_approach = z_pick + 0.12
        z_pregrasp = z_pick + 0.02
        
        current_joints, _ = get_current_state()
        
        # 1. Approach (high clearance)
        q_approach = solve_gazebo_ik(x_rel, y_rel, z_approach, grasp_yaw, seed_joints=current_joints)
        if not q_approach:
            print(f"[SIMULATOR] ERROR: IK failed for pick approach at x={x_rel:.3f} y={y_rel:.3f} z={z_approach:.3f} — aborting pick")
            return
            
        debug_fk(q_approach, label="Approach")
            
        smooth_move(q_approach, ROS_OPEN_GRIPPER, duration_s=2.0)
        
        # 2. Rampa verticale d'approccio
        vertical_path = build_vertical_ik_path(
            x_rel, y_rel, z_approach, z_pregrasp, grasp_yaw,
            seed_joints=q_approach, n=8
        )
        if not vertical_path:
            print(f"[SIMULATOR] ERROR: vertical approach IK path failed — aborting pick")
            return
        send_waypoints(vertical_path, ROS_OPEN_GRIPPER, dt=0.20)

        # 3. Rampa verticale finale al punto di pick
        final_path = build_vertical_ik_path(
            x_rel, y_rel, z_pregrasp, z_pick, grasp_yaw,
            seed_joints=vertical_path[-1], n=6
        )
        if not final_path:
            print(f"[SIMULATOR] ERROR: final descent IK path failed — aborting pick")
            return

        send_waypoints(final_path, ROS_OPEN_GRIPPER, dt=0.20)
        pick_joints = final_path[-1]
        debug_fk(pick_joints, label="Pick Point")

        # FK guard: verify TCP is within tolerance of pick target before closing
        target_urdf = np.array([-y_rel, x_rel, z_pick + URDF_GAZEBO_Z_OFFSET])
        pos_err, _ = fk_position_error(pick_joints, target_urdf)
        if pos_err > IK_POS_TOL:
            print(f"[SIMULATOR] ERROR: FK guard failed at pick — pos_err={pos_err*1000:.1f}mm > {IK_POS_TOL*1000:.0f}mm — aborting pick")
            return

        hand_close = min(30, max(0, int(width_mm - GRIPPER_GRIP_CLEARANCE_MM)))

        # Chiudi pinza e attendi stabilizzazione
        smooth_move(pick_joints, hand_close, duration_s=0.7)
        _interruptible_sleep(0.3)

        # Weld oggetto alla pinza via DetachableJoint (presa rigida, evita slipping)
        if do_attach:
            attach_object_to_gripper()
            _interruptible_sleep(0.2)
        else:
            print("[GRASP] Attach skipped (do_attach=False: spawn failed or disabled)")

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
        print(str(e))


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
                q_ik_fallback = solve_gazebo_ik(x_rel, y_rel, z_carry, pick_grasp_yaw, seed_joints=seed_for_transit)
                if not q_ik_fallback:
                    print("[SIMULATOR] WARNING: gantry transit IK fallback also failed — using last known joint state")
                q_above_place = q_ik_fallback or current_joints
                smooth_move(q_above_place, hand_close, duration_s=2.0)
                print("[SIMULATOR] DEGRADED FALLBACK: gantry transit failed, using joint interp")

            # 2. Vertical descent Cartesian Z-down: z_carry → z_place
            descent_path = build_vertical_ik_path(
                x_rel, y_rel, z_carry, z_place, pick_grasp_yaw,
                seed_joints=q_above_place, n=10
            )
            if descent_path:
                send_waypoints(descent_path, hand_close, dt=0.20)
            place_joints = descent_path[-1] if descent_path else q_above_place
            q_retreat = q_above_place

        else:
            # DEGRADED FALLBACK: no pick context (place called without pick)
            print("[SIMULATOR] DEGRADED FALLBACK: no pick context, using joint interp approach")
            q_up = solve_gazebo_ik(x_rel, y_rel, z_up, grasp_yaw, seed_joints=current_joints)
            if not q_up:
                print("[SIMULATOR] Warning: IK solving failed for place approach")
                q_up = list(SAFE_INTERMEDIATE_POSE)
            smooth_move(q_up, hand_close, duration_s=2.0)

            vertical_path = build_vertical_ik_path(
                x_rel, y_rel, z_up, z_place, grasp_yaw,
                seed_joints=q_up, n=8
            )
            if vertical_path:
                send_waypoints(vertical_path, hand_close, dt=0.20)
            place_joints = vertical_path[-1] if vertical_path else q_up
            q_retreat = q_up

        # 3. Detach + open gripper
        detach_object_from_gripper()
        _interruptible_sleep(0.3)
        smooth_move(place_joints, ROS_OPEN_GRIPPER, duration_s=0.6)
        _interruptible_sleep(0.5)

        # 4. Retreat up (empty gripper from here: joint interp OK)
        smooth_move(q_retreat, ROS_OPEN_GRIPPER, duration_s=1.5)

        # 5. Return to home
        simulate_ros_initial_position(gripper_open=True)

        # Clear pick context
        simulation_recursive_blockly_parser.last_pick_carry_joints = None
        simulation_recursive_blockly_parser.last_pick_x = None

    except Exception as e:
        print(f"[SIMULATOR] Error in simulate_ros_place: {e}")



def simulate_ros_action(action_points: list = []):
    try:
        if len(action_points) > 0:
            sync_current_state_from_ros()
            waypoints = []
            for point in action_points:
                waypoints.append({
                    "j1": point["j1"],
                    "j2": point["j2"],
                    "j3": point["j3"],
                    "j4": point["j4"],
                    "j5": point["j5"],
                    "j6": point["j6"],
                    "hand": 0,
                    "dt": 1.0
                })
            try:
                _bridge.move_path(waypoints)
            except Exception as e:
                print(f"[SIMULATOR] Failed to send move-path: {e}")
            _interruptible_sleep(len(waypoints) * 1.0)

    except Exception as e:
        print(str(e))


def reset_simulation_world():
    try:
        delete_object = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "object"'"""
        delete_location = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "location"'"""

        # Reset slot cycling counter
        simulation_recursive_blockly_parser.place_slot_index = 0

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

        _interruptible_sleep(1.0)
        simulate_ros_initial_position(gripper_open=True)
        _interruptible_sleep(3.0)
    except Exception as e:
        print(f"[SIMULATOR] reset_simulation_world failed: {e}")


def delete_spawned_object_and_place():
    """Remove temporary objects created during PICK/PLACE to allow
    repeating the sequence without resetting the entire world."""
    try:
        delete_object = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "object"'"""
        delete_object_place = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "object_place"'"""
        # Detach before delete: prevents stale weld state across repeated runs.
        print("[GRASP] Cleanup: detaching welded child before removing 'object'")
        detach_object_from_gripper()
        _interruptible_sleep(0.2)
        launch_wsl_ros_command(delete_object)
        _interruptible_sleep(0.4)
        launch_wsl_ros_command(delete_object_place)
        _interruptible_sleep(0.8)
    except Exception as e:
        print(str(e))


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
    else:
        label = f"Condition ({block_type})"

    status = "fulfilled" if simulate_event else "NOT fulfilled"
    print(f"[CONDITION] {label}: {status}")
    return bool(simulate_event)


def _wait_for_condition(condition_block: dict, timeout: int = 60) -> bool:
    """Wait for a vision/human condition via Flask bridge (live mode only).

    On timeout: continues and posts a timeout notification to the frontend.
    """
    block_type = condition_block.get("type", "")

    if block_type == EventsItems.GESTURE.value:
        gesture = condition_block.get("fields", {}).get("GESTURE_TYPE", "THUMBS_UP")
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
        coco_class = to_coco_class(obj_name)
        print(f"[CONDITION] Waiting for object: '{obj_name}' → COCO '{coco_class}' (timeout {timeout}s)...")
        deadline = time.monotonic() + timeout
        detected = False
        while time.monotonic() < deadline:
            if SIMULATION_STOP_EVENT.is_set():
                break
            try:
                state = _bridge.get_vision_state()
                if any(d.get("class") == coco_class for d in state.get("detections", [])):
                    detected = True
                    break
            except Exception:
                pass
            _interruptible_sleep(0.5)
        if not detected:
            print(f"[WARNING] Object '{obj_name}' not detected within {timeout}s — continuing")
            try:
                _bridge.notify("/api/human-step-timeout",
                               {"condition": "object", "value": obj_name})
            except Exception:
                pass
        else:
            print(f"[CONDITION] Object '{obj_name}' detected!")
        return detected

    elif block_type == EventsItems.TIMER.value:
        seconds = int(condition_block.get("fields", {}).get("SECONDS", 5))
        print(f"[CONDITION] Timer: waiting {seconds} seconds...")
        _interruptible_sleep(seconds)
        print("[CONDITION] Timer expired → condition fulfilled")
        return True

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
            obj = objectsOfUser.filter(id=object_data["id"]).first()
            sdf_name = obj.name if obj else object_data.get("name", "unknown")
            safe_sdf_name = sdf_name.replace(" ", "_").lower()
            print(f"[ROBOT] PICK: {sdf_name}")
            height_m, _ = resolve_object_metrics(obj, sdf_name)
            z_spawn_abs = TABLE_TOP_Z_ABS + height_m / 2.0
            cmd = (
                'gz service -s /world/worldCobotta/create '
                '--reqtype gz.msgs.EntityFactory --reptype gz.msgs.Boolean '
                '--timeout 5000 --req \'name: "object"; '
                f'sdf_filename: "objects/{safe_sdf_name}/model.sdf"; '
                f'pose: {{position: {{x: {OBJECT_SPAWN_X}, y: {OBJECT_SPAWN_Y}, z: {z_spawn_abs}}}, '
                'orientation: {x: 0, y: 0, z: 0, w: 1}}\''
            )
            spawn_ok = launch_wsl_ros_command(cmd)
            if not spawn_ok:
                print(f"[SIMULATOR] WARNING: object spawn failed for '{sdf_name}' — pick will run but attach skipped")
            else:
                print(f"[SIMULATOR] Spawn OK: 'object' ({sdf_name}) at z={z_spawn_abs:.3f}")
            _interruptible_sleep(1)
            # Neutralize pending DetachableJoint auto-attach from previous spawn or startup
            print("[GRASP] Post-spawn detach: neutralizing pending auto-attach")
            detach_object_from_gripper()
            simulation_recursive_blockly_parser.last_picked_object = sdf_name
            simulate_ros_pick(obj, sdf_name, do_attach=spawn_ok)
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
                f'sdf_filename: "locations/{safe_loc_sdf_name}/model.sdf"; '
                f'pose: {{position: {{x: {LOCATION_SPAWN_X}, y: {LOCATION_SPAWN_Y}, z: {TABLE_TOP_Z_ABS}}}, '
                'orientation: {x: 0, y: 0, z: 0.7071, w: 0.7071}}\''
            )
            if not launch_wsl_ros_command(loc_cmd):
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
            StepsItems.WAIT.value: _h_wait,
            MacroItems.MACRO_TASK.value: _h_macro,
            "when_start": _h_when_start,
        }

        handler = BLOCK_HANDLERS.get(block_type)
        if handler is not None:
            handler()
        else:
            print(f"[WARNING] Block type unknown or ignored: {block_type}")

    except Exception as e:
        print(f"[ERROR] simulation_recursive_blockly_parser: {e}")


def simulate_task(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                task_id = data.get("id")
                simulate_event = data.get("simulateEvent")
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
                if task.status not in ("published", "published_with_draft"):
                    return error_response("Task not published")

                code = _resolve_runtime_workspace(task)
                if code is None:
                    return error_response("No published workspace available")

                SIMULATION_STOP_EVENT.clear()
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
                    return success_response()
                finally:
                    _set_world_paused(True)
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
