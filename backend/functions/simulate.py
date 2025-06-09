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
from enum import Enum
import time
import platform


class LogicItems(Enum):
    REPEAT = "repeat_block"
    LOOP = "loop_block"
    WHEN_OTHERWISE = "when_otherwise_block"
    WHEN = "when_block"
    # STOP_WHEN = "stop_when_block"
    # DO_WHEN = "do_when_block"


class StepsItems(Enum):
    PICK = "pick_block"
    PROCESSING = "processing_block"
    PLACE = "place_block"


class EventsItems(Enum):
    FIND = "find_object_block"
    SENSOR = "sensor_signal_block"
    HUMAN = "human_feedback_block"
    # DETECT = "detect_block"


class LibrariesItems(Enum):
    OBJECT = "object_block"
    ACTION = "action_block"
    LOCATION = "location_block"


def launch_wsl_ros_command(command: str):
    try:
        # print(platform.system())
        if platform.system() == "Windows":
            subprocess.run(
                ["wsl", "bash", "-c", command],
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
                "cd /mnt/c/repos/blocklyGPT/ros2_ws && source install/setup.bash && ros2 run cobotta_rest_api flask_node",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        subprocess.run(
            [
                "wsl",
                "bash",
                "-c",
                "cd /mnt/c/repos/blocklyGPT/ros2_ws && source install/setup.bash && ros2 run cobotta_rest_api cobotta_node",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        subprocess.run(
            [
                "wsl",
                "bash",
                "-c",
                "cd /mnt/c/repos/blocklyGPT/ros2_ws/Cobotta && ign gazebo -v 4 worldCobottaDensoLimitsOptimised2.sdf",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        subprocess.run(
            [
                "wsl",
                "bash",
                "-c",
                "cd /mnt/c/repos/blocklyGPT/ros2_ws/Cobotta && ros2 run ros_gz_bridge parameter_bridge --ros-args -p config_file:=../Cobotta/map.yaml",
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
ROS_CLOSE_GRIPPER_WITH_OBJECT = 15


def simulate_ros_pick(delete_object_command: str = ""):
    try:
        J1_PICK_APPROACH = 75.58923962550608
        J2_PICK_APPROACH = -0.3536589170994134
        J3_PICK_APPROACH = 89.31830840410409
        J4_PICK_APPROACH = 4.145723768974888
        J5_PICK_APPROACH = 87.22575914827912
        J6_PICK_APPROACH = 1.8681746932240402

        J1_PICK = 69.96086633350203
        J2_PICK = 61.01426999431012
        J3_PICK = 89.11969276224667
        J4_PICK = 1.0908547191248126
        J5_PICK = 28.352809413907178
        J6_PICK = 160.70398691618865

        simulate_ros_move(
            J1_PICK_APPROACH,
            J2_PICK_APPROACH,
            J3_PICK_APPROACH,
            J4_PICK_APPROACH,
            J5_PICK_APPROACH,
            J6_PICK_APPROACH,
            ROS_OPEN_GRIPPER,
        )
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
        launch_wsl_ros_command(delete_object_command)
        simulate_ros_initial_position(False)

    except Exception as e:
        print(str(e))


def simulate_ros_initial_position(gripper_open: bool = True):
    try:
        J1_INITIAL_POSITION = 0.0135501012145749
        J2_INITIAL_POSITION = -0.009626818660299219
        J3_INITIAL_POSITION = 90.01453097663652
        J4_INITIAL_POSITION = -0.011895907514992504
        J5_INITIAL_POSITION = 89.99512641776937
        J6_INITIAL_POSITION = 0.017378369239293395

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
        J1_PLACE = -77.54722925101215
        J2_PLACE = -0.36987250642202263
        J3_PLACE = 89.32364753426154
        J4_PLACE = 4.1421549967203894
        J5_PLACE = 87.277894255997
        J6_PLACE = 1.870657317401082

        simulate_ros_move(
            J1_PLACE,
            J2_PLACE,
            J3_PLACE,
            J4_PLACE,
            J5_PLACE,
            J6_PLACE,
            ROS_CLOSE_GRIPPER_WITH_OBJECT,
        )
        simulate_ros_move(
            J1_PLACE, J2_PLACE, J3_PLACE, J4_PLACE, J5_PLACE, J6_PLACE, ROS_OPEN_GRIPPER
        )
        time.sleep(0.5)
        launch_wsl_ros_command(create_object_place_command)

    except Exception as e:
        print(str(e))


def simulate_ros_action(action_points: list[int] = []):
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


def simulation_recursive_blockly_parser(
    code: dict,
    objectsOfUser: List[Object],
    actionsOfUser: List[Action],
    locationsOfUser: List[Location],
    simulate_event: bool,
):
    try:
        delete_object_pick_command = """ign service -s /world/worldCobotta/remove --reqtype ignition.msgs.Entity --reptype ignition.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "object"'"""
        delete_object_place_command = f"""ign service -s /world/worldCobotta/remove --reqtype ignition.msgs.Entity --reptype ignition.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "object_place"'"""
        delete_location_command = """ign service -s /world/worldCobotta/remove --reqtype ignition.msgs.Entity --reptype ignition.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "location"'"""

        if code["type"] == LogicItems.REPEAT.value:
            times = int(code["fields"]["times"])
            for i in range(0, times):
                simulation_recursive_blockly_parser(
                    code["inputs"]["DO"]["block"],
                    objectsOfUser,
                    actionsOfUser,
                    locationsOfUser,
                    simulate_event,
                )
            launch_wsl_ros_command(delete_location_command)

            if code.get("next") is not None:
                simulation_recursive_blockly_parser(
                    code["next"]["block"],
                    objectsOfUser,
                    actionsOfUser,
                    locationsOfUser,
                    simulate_event,
                )
                launch_wsl_ros_command(delete_location_command)

        elif code["type"] == LogicItems.LOOP.value:
            times = 10  # inf
            for i in range(0, times):
                simulation_recursive_blockly_parser(
                    code["inputs"]["DO"]["block"],
                    objectsOfUser,
                    actionsOfUser,
                    locationsOfUser,
                    simulate_event,
                )
            launch_wsl_ros_command(delete_location_command)

            if code.get("next") is not None:
                simulation_recursive_blockly_parser(
                    code["next"]["block"],
                    objectsOfUser,
                    actionsOfUser,
                    locationsOfUser,
                    simulate_event,
                )
                launch_wsl_ros_command(delete_location_command)

        elif code["type"] == LogicItems.WHEN.value:
            condition_type = (
                code["inputs"]["WHEN"]["block"]["type"].split("_")[0].capitalize()
                + " "
                + code["inputs"]["WHEN"]["block"]["type"].split("_")[1]
            )
            if simulate_event is True:
                if code["inputs"]["WHEN"]["block"]["type"] == EventsItems.FIND.value:
                    object_find = loads(
                        code["inputs"]["WHEN"]["block"]["inputs"]["OBJECT"]["block"][
                            "data"
                        ]
                    )
                    print(
                        condition_type
                        + " '"
                        + object_find["name"]
                        + "': condition fulfilled"
                    )
                else:
                    print(condition_type + ": condition fulfilled")
                simulation_recursive_blockly_parser(
                    code["inputs"]["DO"]["block"],
                    objectsOfUser,
                    actionsOfUser,
                    locationsOfUser,
                    simulate_event,
                )
                launch_wsl_ros_command(delete_location_command)
            else:
                if code["inputs"]["WHEN"]["block"]["type"] == EventsItems.FIND.value:
                    object_find = loads(
                        code["inputs"]["WHEN"]["block"]["inputs"]["OBJECT"]["block"][
                            "data"
                        ]
                    )
                    print(
                        condition_type
                        + " '"
                        + object_find["name"]
                        + "': condition NOT fulfilled"
                    )
                else:
                    print(condition_type + ": condition NOT fulfilled")

            if code.get("next") is not None:
                simulation_recursive_blockly_parser(
                    code["next"]["block"],
                    objectsOfUser,
                    actionsOfUser,
                    locationsOfUser,
                    simulate_event,
                )
                launch_wsl_ros_command(delete_location_command)

        elif code["type"] == LogicItems.WHEN_OTHERWISE.value:
            condition_type = (
                code["inputs"]["WHEN"]["block"]["type"].split("_")[0].capitalize()
                + " "
                + code["inputs"]["WHEN"]["block"]["type"].split("_")[1]
            )
            if simulate_event is True:
                if code["inputs"]["WHEN"]["block"]["type"] == EventsItems.FIND.value:
                    object_find = loads(
                        code["inputs"]["WHEN"]["block"]["inputs"]["OBJECT"]["block"][
                            "data"
                        ]
                    )
                    print(
                        condition_type
                        + " '"
                        + object_find["name"]
                        + "': condition fulfilled"
                    )
                else:
                    print(condition_type + ": condition fulfilled")
                simulation_recursive_blockly_parser(
                    code["inputs"]["DO"]["block"],
                    objectsOfUser,
                    actionsOfUser,
                    locationsOfUser,
                    simulate_event,
                )
                launch_wsl_ros_command(delete_location_command)
            else:
                if code["inputs"]["WHEN"]["block"]["type"] == EventsItems.FIND.value:
                    object_find = loads(
                        code["inputs"]["WHEN"]["block"]["inputs"]["OBJECT"]["block"][
                            "data"
                        ]
                    )
                    print(
                        condition_type
                        + " '"
                        + object_find["name"]
                        + "': condition NOT fulfilled"
                    )
                else:
                    print(condition_type + ": condition NOT fulfilled")
                simulation_recursive_blockly_parser(
                    code["inputs"]["OTHERWISE"]["block"],
                    objectsOfUser,
                    actionsOfUser,
                    locationsOfUser,
                    simulate_event,
                )
                launch_wsl_ros_command(delete_location_command)

            if code.get("next") is not None:
                simulation_recursive_blockly_parser(
                    code["next"]["block"],
                    objectsOfUser,
                    actionsOfUser,
                    locationsOfUser,
                    simulate_event,
                )
                launch_wsl_ros_command(delete_location_command)

        elif code["type"] == StepsItems.PICK.value:
            object_data = loads(code["inputs"]["OBJECT"]["block"]["data"])
            object = objectsOfUser.filter(id=object_data["id"]).first()
            object_sdf_filename = object.name
            create_object_pick_command = f"""ign service -s /world/worldCobotta/create --reqtype ignition.msgs.EntityFactory --reptype ignition.msgs.Boolean --timeout 5000 --req 'name: "object"; sdf_filename: "objects/{object_sdf_filename}/model.sdf"; pose: {{position: {{x: -8.8, y: -1.35, z: 1.05}}, orientation: {{x: 0, y: 0, z: 0, w: 0}}}}'"""
            launch_wsl_ros_command(create_object_pick_command)
            actions_points_array = []

            if code["next"]["block"]["type"] == StepsItems.PROCESSING.value:
                action_data = loads(
                    code["next"]["block"]["inputs"]["ACTION"]["block"]["data"]
                )
                action = actionsOfUser.filter(id=action_data["id"]).first()
                action_points = loads(action.points)["points"]
                actions_points_array.append(action_points)

                next_recursion_root = code["next"]["block"]["next"]["block"]
                location_block_found = False
                while location_block_found is False:
                    if next_recursion_root["type"] == StepsItems.PROCESSING.value:
                        action_data = loads(
                            next_recursion_root["inputs"]["ACTION"]["block"]["data"]
                        )
                        action = actionsOfUser.filter(id=action_data["id"]).first()
                        action_points = loads(action.points)["points"]
                        actions_points_array.append(action_points)
                        next_recursion_root = next_recursion_root["next"]["block"]
                    if next_recursion_root["type"] == StepsItems.PLACE.value:
                        location_data = loads(
                            next_recursion_root["inputs"]["LOCATION"]["block"]["data"]
                        )
                        location = locationsOfUser.filter(
                            id=location_data["id"]
                        ).first()
                        location_sdf_filename = location.name
                        create_location_command = f"""ign service -s /world/worldCobotta/create --reqtype ignition.msgs.EntityFactory --reptype ignition.msgs.Boolean --timeout 5000 --req 'name: "location"; sdf_filename: "locations/{location_sdf_filename}/model.sdf"; pose: {{position: {{x: -9.16, y: -1.18, z: 1.05}}, orientation: {{x: 0, y: 0, z: 0.7071, w: 0.7071}}}}'"""
                        launch_wsl_ros_command(create_location_command)
                        location_block_found = True

            if code["next"]["block"]["type"] == StepsItems.PLACE.value:
                location_data = loads(
                    code["next"]["block"]["inputs"]["LOCATION"]["block"]["data"]
                )
                location = locationsOfUser.filter(id=location_data["id"]).first()
                location_sdf_filename = location.name
                create_location_command = f"""ign service -s /world/worldCobotta/create --reqtype ignition.msgs.EntityFactory --reptype ignition.msgs.Boolean --timeout 5000 --req 'name: "location"; sdf_filename: "locations/{location_sdf_filename}/model.sdf"; pose: {{position: {{x: -9.16, y: -1.18, z: 1.05}}, orientation: {{x: 0, y: 0, z: 0.7071, w: 0.7071}}}}'"""
                launch_wsl_ros_command(create_location_command)

            simulate_ros_pick(delete_object_pick_command)
            for action_points in actions_points_array:
                simulate_ros_action(action_points)
            create_object_place_command = f"""ign service -s /world/worldCobotta/create --reqtype ignition.msgs.EntityFactory --reptype ignition.msgs.Boolean --timeout 5000 --req 'name: "object_place"; sdf_filename: "objects/{object_sdf_filename}/model.sdf"; pose: {{position: {{x: -9.16, y: -1.18, z: 1.25}}, orientation: {{x: 0, y: 0, z: 0, w: 0}}}}'"""
            simulate_ros_place(create_object_place_command)
            time.sleep(1)
            launch_wsl_ros_command(delete_object_place_command)

            # launch_wsl_ros_command(delete_location_command)

        else:
            return error_response("Invalid task structure")

    except Exception as e:
        print(str(e))


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

                simulation_recursive_blockly_parser(
                    code, objectsOfUser, actionsOfUser, locationsOfUser, simulate_event
                )

                return success_response()
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))
