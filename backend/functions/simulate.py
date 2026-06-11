import subprocess
from typing import List
from django.http import HttpResponse, HttpRequest
import requests
from backend.utils.response import (
    HttpMethod,
    invalid_request_method,
    error_response,
    success_response,
    unauthorized_request,
)
from backend.models import Task, Object, Location, Action
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

FLASK_BRIDGE_URL = os.getenv("FLASK_BRIDGE_URL", "http://localhost:5000").rstrip("/")


def convert_hand_gazebo_cobotta(gazebo_hand_value):
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
        response = requests.get(f"{FLASK_BRIDGE_URL}/api/actual-joints-pos", timeout=(0.3, 1.2))
        response.raise_for_status()
        data = response.json()
        pos = data.get("position", [])
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

# Dynamically locate the URDF file
URDF_PATH = None
for root, dirs, files in os.walk(BASE_DIR):
    for f in files:
        if f == "cobotta.urdf" and "cobotta_description" in root:
            URDF_PATH = os.path.join(root, f)
            break

if URDF_PATH and os.path.exists(URDF_PATH):
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
                    max_width = max(max_width, size_x, size_y)
                    
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


def solve_gazebo_ik(x_rel, y_rel, z_rel, grasp_yaw=0.0, seed_joints=None):
    if COBOTTA_CHAIN is None:
        print("[SIMULATOR] Error: ikpy chain not initialized")
        return None
    
    # Transform Gazebo relative coordinates to URDF base frame.
    # URDF X maps to Gazebo -Y, and URDF Y maps to Gazebo X.
    target_urdf = np.array([-y_rel, x_rel, z_rel + URDF_GAZEBO_Z_OFFSET])
    
    # Grasp orientation: point Z-axis downward in URDF frame
    target_orientation = [0.0, 0.0, -1.0]
    
    initial_position = [0.0] * len(COBOTTA_CHAIN.links)
    
    if seed_joints is not None:
        seed_map = {
            'joint1': math.radians(seed_joints[0]),
            'joint2': math.radians(seed_joints[1]),
            'joint3': math.radians(seed_joints[2]),
            'joint4': math.radians(seed_joints[3]),
            'joint5': math.radians(seed_joints[4]),
            'joint6': math.radians(seed_joints[5]),
        }
        for i, link in enumerate(COBOTTA_CHAIN.links):
            if link.name in seed_map:
                initial_position[i] = seed_map[link.name]
    else:
        target_j1 = math.atan2(x_rel, -y_rel)
        for i, link in enumerate(COBOTTA_CHAIN.links):
            if link.name == 'joint1':
                initial_position[i] = target_j1
            elif link.name == 'joint2':
                initial_position[i] = math.radians(45.0)
            elif link.name == 'joint3':
                initial_position[i] = math.radians(70.0)
            elif link.name == 'joint4':
                initial_position[i] = 0.0
            elif link.name == 'joint5':
                initial_position[i] = math.radians(45.0)
            elif link.name == 'joint6':
                initial_position[i] = grasp_yaw
            
    try:
        ik_solution = COBOTTA_CHAIN.inverse_kinematics(
            target_urdf,
            target_orientation=target_orientation,
            orientation_mode="Z",
            initial_position=initial_position
        )
        
        # Extract angles in degrees for joint1-6
        angles_deg = []
        joint_names = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6']
        for name in joint_names:
            for i, link in enumerate(COBOTTA_CHAIN.links):
                if link.name == name:
                    angles_deg.append(math.degrees(ik_solution[i]))
                    break
        return angles_deg
    except Exception as e:
        print(f"[SIMULATOR] IK solver failed: {e}")
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
        "collector": 0.06,  # test tube rack
        "cup": 0.08,
        "pot": 0.06,
        "pulvis": 0.05,
        "plate": 0.02,
        "divider": 0.05,
        "box": 0.08,
        "pillbox": 0.04
    }
    if not sdf_name:
        return 0.05
    safe_name = os.path.basename(sdf_name)
    sdf_height, _ = get_sdf_dimensions(safe_name, folder="locations")
    if sdf_height is not None and sdf_height > 0.001:
        return sdf_height
    return location_heights.get(safe_name, 0.05)


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
    try:
        ros_url = f"{FLASK_BRIDGE_URL}/api/move-joints"
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
        response = requests.get(ros_url, params=ros_params, timeout=(0.3, 1.2))
        response.raise_for_status()
    except Exception as e:
        print(f"[SIMULATOR] simulate_ros_move failed params={ros_params}: {e}")

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
        ros_url = f"{FLASK_BRIDGE_URL}/api/move-path"
        response = requests.post(ros_url, json={"waypoints": waypoints}, timeout=5.0)
        response.raise_for_status()
    except Exception as e:
        print(f"[SIMULATOR] Failed to send move-path: {e}")

    set_current_state(target_joints, hand)
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
        ros_url = f"{FLASK_BRIDGE_URL}/api/move-path"
        response = requests.post(ros_url, json={"waypoints": waypoints}, timeout=5.0)
        response.raise_for_status()
    except Exception as e:
        print(f"[SIMULATOR] Failed to send move-path: {e}")
    set_current_state(joints_list[-1], hand)
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
            if max_delta > 30.0:
                print(f"[SIMULATOR] Kinematic jump detected: max delta {max_delta} > 30.0 degrees at z={z}")
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
            if max_delta > 30.0:
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

# URDF→Gazebo frame offset: Z_gazebo = Z_urdf - URDF_GAZEBO_Z_OFFSET
URDF_GAZEBO_Z_OFFSET = 0.085

# Default pick/place coordinates relative to robot base (Gazebo frame, m)
DEFAULT_PICK_X_REL = -0.05
DEFAULT_PICK_Y_REL = -0.28
DEFAULT_PLACE_X_REL = 0.20
DEFAULT_PLACE_Y_REL = -0.21

# Safe intermediate pose used before/after MOVE_TO and as IK fallback (degrees)
SAFE_INTERMEDIATE_POSE = [51.56, 20.05, 87.08, 0.0, 48.70, 0.0]

# Gazebo world spawn positions (absolute, Gazebo frame)
TABLE_TOP_Z_ABS = 1.04          # Z of table surface (m)
OBJECT_SPAWN_X = -9.05          # X of object spawn point
OBJECT_SPAWN_Y = -1.48
LOCATION_SPAWN_X = -8.8         # X of location model spawn point
LOCATION_SPAWN_Y = -1.41
PLACE_REPLICA_X = -9.16         # X of place-replica object spawn
PLACE_REPLICA_Y = -1.18
PLACE_REPLICA_Z = 1.25


def simulate_ros_pick(obj, sdf_name: str = ""):
    try:
        # Sync state from ROS first to anchor the IK seeds
        sync_current_state_from_ros()
        
        # Resolve dimensions
        height_m, width_m = resolve_object_metrics(obj, sdf_name)
        width_mm = width_m * 1000.0
        
        # Object relative coordinates
        x_rel = DEFAULT_PICK_X_REL
        y_rel = DEFAULT_PICK_Y_REL
        grasp_yaw = getattr(obj, "grasp_yaw", 0.0) or 0.0
        
        # Flask: target sul corpo (sotto il tappo), non sul collo stretto
        if os.path.basename(sdf_name).lower() in {"flask", "blue_cylinder"}:
            z_pick = -0.01 + 0.024  # corpo flask: dita afferrano sotto il tappo
        elif height_m > 0.04:
            z_pick = -0.01 + max(height_m / 2.0, height_m - 0.03)
        else:
            z_pick = -0.01 + height_m / 2.0

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
        if vertical_path:
            send_waypoints(vertical_path, ROS_OPEN_GRIPPER, dt=0.20)

        # 3. Rampa verticale finale al punto di pick
        final_seed = vertical_path[-1] if vertical_path else q_approach
        final_path = build_vertical_ik_path(
            x_rel, y_rel, z_pregrasp, z_pick, grasp_yaw,
            seed_joints=final_seed, n=6
        )
        if final_path:
            send_waypoints(final_path, ROS_OPEN_GRIPPER, dt=0.20)
                
        pick_joints = final_path[-1] if final_path else final_seed
        debug_fk(pick_joints, label="Pick Point")
        
        if os.path.basename(sdf_name).lower() in {"flask", "blue_cylinder"}:
            hand_close = 0  # collision 15mm = visivo, hand=0 → ~3mm interferenza reale
        else:
            hand_close = min(30, max(0, int(width_mm - 4.0)))  # Stringi di più la pinza in generale
        
        # Chiudi pinza e attendi stabilizzazione
        smooth_move(pick_joints, hand_close, duration_s=0.7)
        time.sleep(0.3)

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


def simulate_ros_place(create_object_place_command, picked_obj_name: str = "", objectsOfUser = None, location_name: str = "collector"):
    try:
        # Sync state from ROS
        sync_current_state_from_ros()
        
        # Retrieve picked object's metrics if available
        obj = None
        if objectsOfUser is not None and picked_obj_name:
            obj = objectsOfUser.filter(name=picked_obj_name).first()
            
        height_m, width_m = resolve_object_metrics(obj, picked_obj_name)
        width_mm = width_m * 1000.0
        
        # Close gap
        hand_close = int(max(0.0, min(30.0, width_mm - 0.5)))
        
        # Target coordinates
        x_rel = DEFAULT_PLACE_X_REL
        y_rel = DEFAULT_PLACE_Y_REL
        
        loc_height = resolve_location_metrics(location_name)
        
        # Calculate dynamic grip Z offset
        if height_m > 0.04:
            z_grip = max(height_m / 2.0, height_m - 0.03)
        else:
            z_grip = height_m / 2.0
            
        z_place = -0.01 + loc_height + 0.02 + z_grip
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

        # 3. Open gripper
        smooth_move(place_joints, ROS_OPEN_GRIPPER, duration_s=0.6)
        time.sleep(0.5)

        # Spawn the replica object in Gazebo
        launch_wsl_ros_command(create_object_place_command)
        time.sleep(0.5)

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
                ros_url = f"{FLASK_BRIDGE_URL}/api/move-path"
                response = requests.post(ros_url, json={"waypoints": waypoints}, timeout=5.0)
                response.raise_for_status()
            except Exception as e:
                print(f"[SIMULATOR] Failed to send move-path: {e}")
            _interruptible_sleep(len(waypoints) * 1.0)

    except Exception as e:
        print(str(e))


def reset_simulation_world():
    try:
        delete_object = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "object"'"""
        delete_location = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "location"'"""

        # Delete failures are tolerated — entities may not exist on first run.
        if not launch_wsl_ros_command(delete_object):
            print("[SIMULATOR] reset: delete 'object' failed (may not exist)")
        time.sleep(0.3)
        if not launch_wsl_ros_command(delete_location):
            print("[SIMULATOR] reset: delete 'location' failed (may not exist)")

        time.sleep(1.0)
        simulate_ros_initial_position(gripper_open=True)
        time.sleep(3.0)
    except Exception as e:
        print(f"[SIMULATOR] reset_simulation_world failed: {e}")


def delete_spawned_object_and_place():
    """Remove temporary objects created during PICK/PLACE to allow
    repeating the sequence without resetting the entire world."""
    try:
        delete_object = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "object"'"""
        delete_object_place = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "object_place"'"""
        launch_wsl_ros_command(delete_object)
        time.sleep(0.4)
        launch_wsl_ros_command(delete_object_place)
        time.sleep(0.8)
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
    elif block_type == EventsItems.SENSOR.value:
        label = "External sensor signal"
    elif block_type == EventsItems.HUMAN.value:
        label = "Human feedback"
    elif block_type == EventsItems.TOUCH.value:
        label = "Touch detect"
    elif block_type == EventsItems.GESTURE.value:
        gesture = condition_block.get("fields", {}).get("GESTURE_TYPE", "THUMBS_UP")
        label = f"Gesture detected ({gesture})"
    elif block_type == EventsItems.TIMER.value:
        seconds = int(condition_block.get("fields", {}).get("SECONDS", 5))
        print(f"[CONDITION] Timer: waiting {seconds} seconds...")
        time.sleep(seconds)
        print("[CONDITION] Timer expired → condition fulfilled")
        return True
    else:
        label = f"Condition ({block_type})"

    status = "fulfilled" if simulate_event else "NOT fulfilled"
    print(f"[CONDITION] {label}: {status}")
    return bool(simulate_event)


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
    Logic    : repeat_block, loop_block, repeat_until_block,
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

        # ══════════════════════════════════════════════════════════════════════
        # LOGIC / CONTROL FLOW
        # ══════════════════════════════════════════════════════════════════════

        if block_type == LogicItems.REPEAT.value:
            times = int(code["fields"]["times"])
            print(f"[LOGIC] Repeat x{times}")
            for i in range(times):
                print(f"[LOGIC]   iteration {i + 1}/{times}")
                _recurse("DO")
                delete_spawned_object_and_place()
            time.sleep(3)
            _next()

        elif block_type == LogicItems.LOOP.value:
            # Safety cap: a true infinite loop would block the Django thread.
            MAX_LOOP_ITERATIONS = 10
            print(f"[LOGIC] Loop forever (capped at {MAX_LOOP_ITERATIONS} in simulation)")
            for i in range(MAX_LOOP_ITERATIONS):
                print(f"[LOGIC]   loop iteration {i + 1}/{MAX_LOOP_ITERATIONS}")
                _recurse("DO")
                delete_spawned_object_and_place()
            time.sleep(3)
            _next()

        elif block_type == LogicItems.REPEAT_UNTIL.value:
            # In simulation real sensor events cannot be injected in real-time.
            # The condition is treated as fulfilled after the first iteration.
            MAX_ITERATIONS = 10
            print(f"[LOGIC] Repeat-Until (max {MAX_ITERATIONS} iterations in simulation)")
            condition_block = code.get("inputs", {}).get("CONDITION", {}).get("block")
            for i in range(MAX_ITERATIONS):
                print(f"[LOGIC]   repeat-until iteration {i + 1}/{MAX_ITERATIONS}")
                _recurse("DO")
                fulfilled = (
                    _log_condition(condition_block, simulate_event)
                    if condition_block else True
                )
                if fulfilled:
                    print("[LOGIC] Repeat-Until: condition met, exiting loop")
                    break
                delete_spawned_object_and_place()
            time.sleep(3)
            _next()

        elif block_type == LogicItems.WHEN.value:
            condition_block = code["inputs"]["WHEN"]["block"]
            fulfilled = _log_condition(condition_block, simulate_event)
            if fulfilled:
                _recurse("DO")
                time.sleep(3)
            _next()

        elif block_type == LogicItems.WHEN_OTHERWISE.value:
            condition_block = code["inputs"]["WHEN"]["block"]
            fulfilled = _log_condition(condition_block, simulate_event)
            if fulfilled:
                _recurse("DO")
            else:
                _recurse("OTHERWISE")
            time.sleep(3)
            _next()

        # ══════════════════════════════════════════════════════════════════════
        # HUMAN ACTIONS
        # ══════════════════════════════════════════════════════════════════════

        elif block_type == StepsItems.HUMAN_ACTION.value:
            task_desc = code.get("fields", {}).get("TASK_DESC", "No description")
            print(f"\n[!] HUMAN ACTION REQUIRED: {task_desc}")
            confirm_event = code.get("inputs", {}).get("CONFIRM_EVENT", {}).get("block")
            if confirm_event:
                # Always execute the wait/log regardless of simulate_event flag
                _log_condition(confirm_event, simulate_event=True)
            _next()

        elif block_type == StepsItems.NOTIFY_ACTION.value:
            # Non-blocking: log only, robot continues immediately.
            task_desc = code.get("fields", {}).get("TASK_DESC", "No description")
            print(f"\n[NOTIFY] Operator message: {task_desc}")
            _next()

        # ══════════════════════════════════════════════════════════════════════
        # ROBOT STEP ACTIONS
        # ══════════════════════════════════════════════════════════════════════

        elif block_type == StepsItems.PICK.value:
            object_data = loads(code["inputs"]["OBJECT"]["block"]["data"])
            obj = objectsOfUser.filter(id=object_data["id"]).first()
            sdf_name = obj.name if obj else object_data.get("name", "unknown")
            print(f"[ROBOT] PICK: {sdf_name}")
            height_m, _ = resolve_object_metrics(obj, sdf_name)
            z_spawn_abs = TABLE_TOP_Z_ABS + height_m / 2.0
            cmd = (
                'gz service -s /world/worldCobotta/create '
                '--reqtype gz.msgs.EntityFactory --reptype gz.msgs.Boolean '
                '--timeout 5000 --req \'name: "object"; '
                f'sdf_filename: "objects/{sdf_name}/model.sdf"; '
                f'pose: {{position: {{x: {OBJECT_SPAWN_X}, y: {OBJECT_SPAWN_Y}, z: {z_spawn_abs}}}, '
                'orientation: {x: 0, y: 0, z: 0, w: 1}}\''
            )
            if not launch_wsl_ros_command(cmd):
                print(f"[SIMULATOR] WARNING: object spawn failed for '{sdf_name}' — pick may fail")
            time.sleep(1)
            simulation_recursive_blockly_parser.last_picked_object = sdf_name
            simulate_ros_pick(obj, sdf_name)
            _next()

        elif block_type == StepsItems.PLACE.value:
            location_data = loads(code["inputs"]["LOCATION"]["block"]["data"])
            location = locationsOfUser.filter(id=location_data["id"]).first()
            sdf_name = location.name if location else location_data.get("name", "unknown")
            print(f"[ROBOT] PLACE: {sdf_name}")
            loc_cmd = (
                'gz service -s /world/worldCobotta/create '
                '--reqtype gz.msgs.EntityFactory --reptype gz.msgs.Boolean '
                '--timeout 5000 --req \'name: "location"; '
                f'sdf_filename: "locations/{sdf_name}/model.sdf"; '
                f'pose: {{position: {{x: {LOCATION_SPAWN_X}, y: {LOCATION_SPAWN_Y}, z: {TABLE_TOP_Z_ABS}}}, '
                'orientation: {x: 0, y: 0, z: 0.7071, w: 0.7071}}\''
            )
            if not launch_wsl_ros_command(loc_cmd):
                print(f"[SIMULATOR] WARNING: location spawn failed for '{sdf_name}' — place may fail")

            # Spawn replica dell'oggetto effettivamente preso
            picked_obj_name = getattr(simulation_recursive_blockly_parser, "last_picked_object", "flask")
            obj_cmd = (
                'gz service -s /world/worldCobotta/create '
                '--reqtype gz.msgs.EntityFactory --reptype gz.msgs.Boolean '
                '--timeout 5000 --req \'name: "object_place"; '
                f'sdf_filename: "objects/{picked_obj_name}/model.sdf"; '
                f'pose: {{position: {{x: {PLACE_REPLICA_X}, y: {PLACE_REPLICA_Y}, z: {PLACE_REPLICA_Z}}}, '
                'orientation: {x: 0, y: 0, z: 0, w: 1}}\''
            )
            simulate_ros_place(obj_cmd, picked_obj_name, objectsOfUser, sdf_name)
            time.sleep(1)
            _next()

        elif block_type == StepsItems.PROCESSING.value:
            action_data = loads(code["inputs"]["ACTION"]["block"]["data"])
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

        elif block_type == StepsItems.MOVE_TO.value:
            location_data = loads(code["inputs"]["LOCATION"]["block"]["data"])
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
                    simulate_ros_move(
                        pos["j1"], pos["j2"], pos["j3"],
                        pos["j4"], pos["j5"], pos["j6"],
                        ROS_OPEN_GRIPPER,
                    )
                    moved = True

            if not moved:
                print(f"[ROBOT]   No joint data in DB for '{location_name}' → using default intermediate position")
                simulate_ros_move(*SAFE_INTERMEDIATE_POSE, ROS_CLOSE_GRIPPER_WITH_OBJECT)

            time.sleep(2)
            _next()

        elif block_type == StepsItems.GRIPPER.value:
            state = code.get("fields", {}).get("GRIPPER_STATE", "CLOSE")
            if state == "OPEN":
                print("[ROBOT] Opening gripper")
                hand_value = ROS_OPEN_GRIPPER
            else:
                print("[ROBOT] Closing gripper")
                hand_value = ROS_CLOSE_GRIPPER_WITH_OBJECT
            # Send only the hand command, keeping arm at safe home (J3=90°)
            simulate_ros_move(0, 0, 90, 0, 0, 0, hand_value, joint_abs=True)
            time.sleep(1)
            _next()

        # ══════════════════════════════════════════════════════════════════════
        # MACRO TASKS
        # ══════════════════════════════════════════════════════════════════════

        elif block_type == MacroItems.MACRO_TASK.value:
            macro_data = loads(code["data"])
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

        elif block_type == "when_start":
            print("[LOGIC] Start sequence")
            _next()

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
                reset_simulation_world()

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
                    requests.post(
                        f"{FLASK_BRIDGE_URL}/api/stop",
                        timeout=(0.3, 1.2),
                    )
                except Exception as e:
                    print(f"[SIMULATOR] Could not forward stop to Flask bridge: {e}")
                return success_response()
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))
