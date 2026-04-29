from math import inf
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

# All block type identifiers: shared source of truth
from backend.block_types import (
    LogicItems,
    StepsItems,
    EventsItems,
    LibrariesItems,
    MacroItems,
)


def launch_wsl_ros_command(command: str):
    try:
        if platform.system() == "Windows":
            subprocess.run(
                ["wsl", "-d", "Ubuntu-24.04", "bash", "-c", command],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        elif platform.system() == "Linux":
            subprocess.run(
                ["bash", "-c", command],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        else:
            print("Unsupported OS")
    except Exception as e:
        print(str(e))


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
    joint_1: int,
    joint_2: int,
    joint_3: int,
    joint_4: int,
    joint_5: int,
    joint_6: int,
    hand: int,
    joint_abs: bool = False,
):
    try:
        ros_url = "http://localhost:5000/api/move-joints"
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
        requests.get(ros_url, params=ros_params)

    except Exception as e:
        print(str(e))


ROS_OPEN_GRIPPER = 30
ROS_GRIPPER_GENTLE_CLOSE = 10
ROS_CLOSE_GRIPPER_WITH_OBJECT = 0


def simulate_ros_pick():
    try:
        J1_PICK_APPROACH = 0.0
        J2_PICK_APPROACH = 45.836623610465856701438523851284
        J3_PICK_APPROACH = 80.214091318315249227517416739747
        J4_PICK_APPROACH = 0.0
        J5_PICK_APPROACH = 0.0
        J6_PICK_APPROACH = 0.0

        J1_PICK = 0.0
        J2_PICK = 51.566201561774088789118339332695
        J3_PICK = 96.538036196585829446716955443274
        J4_PICK = 0.0
        J5_PICK = 0.0
        J6_PICK = 0.0

        # Approach position
        simulate_ros_move(
            J1_PICK_APPROACH,
            J2_PICK_APPROACH,
            J3_PICK_APPROACH,
            J4_PICK_APPROACH,
            J5_PICK_APPROACH,
            J6_PICK_APPROACH,
            ROS_OPEN_GRIPPER,
        )
        time.sleep(3)

        # Pick position - close to the object
        simulate_ros_move(
            J1_PICK,
            J2_PICK,
            J3_PICK,
            J4_PICK,
            J5_PICK,
            J6_PICK,
            ROS_OPEN_GRIPPER,
        )
        time.sleep(4)

        # Complete closure
        simulate_ros_move(
            J1_PICK,
            J2_PICK,
            J3_PICK,
            J4_PICK,
            J5_PICK,
            J6_PICK,
            ROS_CLOSE_GRIPPER_WITH_OBJECT,
        )
        time.sleep(1)

        simulate_ros_initial_position(False)

    except Exception as e:
        print(str(e))


def simulate_ros_initial_position(gripper_open: bool = True):
    try:
        J1_INITIAL_POSITION = 0
        J2_INITIAL_POSITION = 0
        J3_INITIAL_POSITION = 90
        J4_INITIAL_POSITION = 0
        J5_INITIAL_POSITION = 0
        J6_INITIAL_POSITION = 0

        if gripper_open:
            simulate_ros_move(
                J1_INITIAL_POSITION,
                J2_INITIAL_POSITION,
                J3_INITIAL_POSITION,
                J4_INITIAL_POSITION,
                J5_INITIAL_POSITION,
                J6_INITIAL_POSITION,
                ROS_OPEN_GRIPPER,
            )
        else:
            simulate_ros_move(
                J1_INITIAL_POSITION,
                J2_INITIAL_POSITION,
                J3_INITIAL_POSITION,
                J4_INITIAL_POSITION,
                J5_INITIAL_POSITION,
                J6_INITIAL_POSITION,
                ROS_CLOSE_GRIPPER_WITH_OBJECT,
            )

    except Exception as e:
        print(str(e))


def simulate_ros_place(create_object_place_command):
    try:
        J1_PLACE = 51.566201561774088789118339332695
        J2_PLACE = 53.285074947166558415422283977118
        J3_PLACE = 80.214091318315249227517416739747
        J4_PLACE = 0.0
        J5_PLACE = 20.053522829578812306879354184937
        J6_PLACE = 0.0

        J1_NEAR = 51.566201561774088789118339332695
        J2_NEAR = 20.053522829578812306879354184937
        J3_NEAR = 87.08958485988512773273319531744
        J4_NEAR = 0.0
        J5_NEAR = 48.701412586119972745278431591989
        J6_NEAR = 0.0

        # Intermediate lift before place
        J1_UP = 0.0
        J2_UP = 20.053522829578812306879354184937
        J3_UP = 68.754935415698785052157785776926
        J4_UP = 0.0
        J5_UP = 22.918311805232928350719261925642
        J6_UP = 0.0

        # Lift
        simulate_ros_move(
            J1_UP, J2_UP, J3_UP, J4_UP, J5_UP, J6_UP,
            ROS_CLOSE_GRIPPER_WITH_OBJECT,
        )
        time.sleep(2)

        # Rotation
        simulate_ros_move(
            J1_NEAR, J2_UP, J3_UP, J4_UP, J5_UP, J6_UP,
            ROS_CLOSE_GRIPPER_WITH_OBJECT,
        )
        time.sleep(1)

        # Lower 1
        simulate_ros_move(
            J1_NEAR, J2_NEAR, J3_NEAR, J4_NEAR, J5_NEAR, J6_NEAR,
            ROS_CLOSE_GRIPPER_WITH_OBJECT,
        )
        time.sleep(1)

        # Lower 2
        simulate_ros_move(
            J1_PLACE, J2_PLACE, J3_PLACE, J4_PLACE, J5_PLACE, J6_PLACE,
            ROS_CLOSE_GRIPPER_WITH_OBJECT,
        )
        time.sleep(2)

        # Open gripper to release
        simulate_ros_move(
            J1_PLACE, J2_PLACE, J3_PLACE, J4_PLACE, J5_PLACE, J6_PLACE,
            ROS_OPEN_GRIPPER,
        )
        time.sleep(0.5)
        time.sleep(0.5)
        simulate_ros_initial_position(gripper_open=True)

    except Exception as e:
        print(str(e))


def simulate_ros_action(action_points: list = []):
    try:
        if len(action_points) > 0:
            for point in action_points:
                simulate_ros_move(
                    point["j1"],
                    point["j2"],
                    point["j3"],
                    point["j4"],
                    point["j5"],
                    point["j6"],
                    ROS_CLOSE_GRIPPER_WITH_OBJECT,
                )

    except Exception as e:
        print(str(e))


def reset_simulation_world():
    try:
        delete_object = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "object"'"""
        delete_location = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "location"'"""

        launch_wsl_ros_command(delete_object)
        time.sleep(0.3)
        launch_wsl_ros_command(delete_location)

        time.sleep(1.0)
        simulate_ros_initial_position(gripper_open=True)
        time.sleep(3.0)
    except Exception as e:
        print(str(e))


def delete_spawned_object_and_place():
    """Remove temporary objects created during PICK/PLACE to allow
    repeating the sequence without resetting the entire world."""
    try:
        delete_object = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "object"'"""
        delete_object_place = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "object_place"'"""
        launch_wsl_ros_command(delete_object)
        time.sleep(0.2)
        launch_wsl_ros_command(delete_object_place)
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
    try:
        block_type = code["type"]

        # ── Inline helpers ────────────────────────────────────────────────────

        def _next():
            """Continue execution with the next chained block."""
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
            cmd = (
                'gz service -s /world/worldCobotta/create '
                '--reqtype gz.msgs.EntityFactory --reptype gz.msgs.Boolean '
                '--timeout 5000 --req \'name: "object"; '
                f'sdf_filename: "objects/{sdf_name}/model.sdf"; '
                'pose: {position: {x: -9.05, y: -1.48, z: 1.065}, '
                'orientation: {x: 0, y: 0, z: 0, w: 1}}\''
            )
            launch_wsl_ros_command(cmd)
            time.sleep(1)
            simulate_ros_pick()
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
                'pose: {position: {x: -8.8, y: -1.41, z: 1.065}, '
                'orientation: {x: 0, y: 0, z: 0.7071, w: 0.7071}}\''
            )
            launch_wsl_ros_command(loc_cmd)
            obj_cmd = (
                'gz service -s /world/worldCobotta/create '
                '--reqtype gz.msgs.EntityFactory --reptype gz.msgs.Boolean '
                '--timeout 5000 --req \'name: "object_place"; '
                'sdf_filename: "objects/flask/model.sdf"; '
                'pose: {position: {x: -9.16, y: -1.18, z: 1.25}, '
                'orientation: {x: 0, y: 0, z: 0, w: 1}}\''
            )
            simulate_ros_place(obj_cmd)
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
                        ROS_CLOSE_GRIPPER_WITH_OBJECT,
                    )
                    moved = True

            if not moved:
                print(f"[ROBOT]   No joint data in DB for '{location_name}' → using default intermediate position")
                simulate_ros_move(51.56, 20.05, 87.08, 0.0, 48.70, 0.0, ROS_CLOSE_GRIPPER_WITH_OBJECT)

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
                task = Task.objects.filter(id=task_id).first()
                if task is None:
                    return error_response("Task not found")

                objectsOfUser = Object.objects.filter(
                    Q(owner=request.user.id) | Q(shared=True)
                )
                actionsOfUser = Action.objects.filter(
                    Q(owner=request.user.id) | Q(shared=True)
                )
                locationsOfUser = Location.objects.filter(
                    Q(owner=request.user.id) | Q(shared=True)
                )
                code = loads(task.code)

                reset_simulation_world()

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
