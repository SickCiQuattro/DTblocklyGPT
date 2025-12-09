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
    # LOOP = "loop_block"
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

        # Gradual closing for stable contact
        # First partial closure
        # simulate_ros_move(
        #     J1_PICK,
        #     J2_PICK,
        #     J3_PICK,
        #     J4_PICK,
        #     J5_PICK,
        #     J6_PICK,
        #     ROS_GRIPPER_GENTLE_CLOSE,
        # )
        # time.sleep(1.5)

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

        # sollevamento intermedio prima del place
        J1_UP = 0.0
        J2_UP = 20.053522829578812306879354184937
        J3_UP = 68.754935415698785052157785776926
        J4_UP = 0.0
        J5_UP = 22.918311805232928350719261925642
        J6_UP = 0.0

        # sollevamento
        simulate_ros_move(
            J1_UP,
            J2_UP,
            J3_UP,
            J4_UP,
            J5_UP,
            J6_UP,
            ROS_CLOSE_GRIPPER_WITH_OBJECT,
        )
        time.sleep(2)

        # rotazione
        simulate_ros_move(
            J1_NEAR,
            J2_UP,
            J3_UP,
            J4_UP,
            J5_UP,
            J6_UP,
            ROS_CLOSE_GRIPPER_WITH_OBJECT,
        )
        time.sleep(1)

        # abbassamento 1
        simulate_ros_move(
            J1_NEAR,
            J2_NEAR,
            J3_NEAR,
            J4_NEAR,
            J5_NEAR,
            J6_NEAR,
            ROS_CLOSE_GRIPPER_WITH_OBJECT,
        )
        time.sleep(1)

        # abbassamento 2
        simulate_ros_move(
            J1_PLACE,
            J2_PLACE,
            J3_PLACE,
            J4_PLACE,
            J5_PLACE,
            J6_PLACE,
            ROS_CLOSE_GRIPPER_WITH_OBJECT,
        )
        time.sleep(2)
        
        # Open gripper to release
        simulate_ros_move(
            J1_PLACE, J2_PLACE, J3_PLACE, J4_PLACE, J5_PLACE, J6_PLACE, ROS_OPEN_GRIPPER
        )
        time.sleep(0.5)
        # launch_wsl_ros_command(create_object_place_command)
        time.sleep(0.5)
        simulate_ros_initial_position(gripper_open=True)
        

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


def reset_simulation_world():
    try:
        delete_object = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "object"'"""
        # delete_object_place = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "object_place"'"""
        delete_location = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "location"'"""
        
        launch_wsl_ros_command(delete_object)
        time.sleep(0.3)
        # launch_wsl_ros_command(delete_object_place)
        # time.sleep(0.3)
        launch_wsl_ros_command(delete_location)
        
        time.sleep(1.0)
        simulate_ros_initial_position(gripper_open=True)
        time.sleep(3.0)
    except Exception as e:
        print(str(e))


def delete_spawned_object_and_place():
    """Rimuove gli oggetti temporanei creati durante PICK/PLACE per permettere
    di ripetere la sequenza senza resettare l'intero mondo."""
    try:
        delete_object = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "object"'"""
        delete_object_place = """gz service -s /world/worldCobotta/remove --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean --timeout 5000 --req 'type: MODEL, name: "object_place"'"""
        launch_wsl_ros_command(delete_object)
        time.sleep(0.2)
        launch_wsl_ros_command(delete_object_place)
    except Exception as e:
        print(str(e))


def simulation_recursive_blockly_parser(
    code: dict,
    objectsOfUser: List[Object],
    actionsOfUser: List[Action],
    locationsOfUser: List[Location],
    simulate_event: bool,
    inside_conditional: bool = False,  # Flag per sapere se siamo dentro un WHEN
):
    try:
        
        if code["type"] == LogicItems.REPEAT.value:
            times = int(code["fields"]["times"])
            for i in range(0, times):
                simulation_recursive_blockly_parser(
                    code["inputs"]["DO"]["block"],
                    objectsOfUser,
                    actionsOfUser,
                    locationsOfUser,
                    simulate_event,
                    inside_conditional,
                )
                delete_spawned_object_and_place()
            time.sleep(3)
            

            if code.get("next") is not None:
                simulation_recursive_blockly_parser(
                    code["next"]["block"],
                    objectsOfUser,
                    actionsOfUser,
                    locationsOfUser,
                    simulate_event,
                    inside_conditional,
                )
                time.sleep(3)
                

        # elif code["type"] == LogicItems.LOOP.value:
        #     times = 10  # inf
        #     for i in range(0, times):
        #         simulation_recursive_blockly_parser(
        #             code["inputs"]["DO"]["block"],
        #             objectsOfUser,
        #             actionsOfUser,
        #             locationsOfUser,
        #             simulate_event,
        #         )
        #     

        #     if code.get("next") is not None:
        #         simulation_recursive_blockly_parser(
        #             code["next"]["block"],
        #             objectsOfUser,
        #             actionsOfUser,
        #             locationsOfUser,
        #             simulate_event,
        #         )
        #         

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
                    inside_conditional=True,  # Entriamo in un blocco condizionale
                )
                time.sleep(3)
                
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
                    inside_conditional,
                )
                time.sleep(3)
                

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
                    inside_conditional=True,  # Entriamo in un blocco condizionale
                )
                time.sleep(3)
                
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
                    inside_conditional=True,  # Entriamo in un blocco condizionale
                )
                time.sleep(3)
                

            if code.get("next") is not None:
                simulation_recursive_blockly_parser(
                    code["next"]["block"],
                    objectsOfUser,
                    actionsOfUser,
                    locationsOfUser,
                    simulate_event,
                    inside_conditional,
                )
                time.sleep(3)
                

        elif code["type"] == StepsItems.PICK.value:
            object_data = loads(code["inputs"]["OBJECT"]["block"]["data"])
            object = objectsOfUser.filter(id=object_data["id"]).first()
            object_sdf_filename = object.name
            
            create_object_pick_command = f"""gz service -s /world/worldCobotta/create --reqtype gz.msgs.EntityFactory --reptype gz.msgs.Boolean --timeout 5000 --req 'name: "object"; sdf_filename: "objects/{object_sdf_filename}/model.sdf"; pose: {{position: {{x: -9.05, y: -1.48, z: 1.065}}, orientation: {{x: 0, y: 0, z: 0, w: 1}}}}'"""
            launch_wsl_ros_command(create_object_pick_command)
            time.sleep(1)
            
            actions_points_array = []
            location_sdf_filename = None
            create_location_command = None

            # Se siamo dentro un blocco condizionale (WHEN/OTHERWISE),
            # gestiamo PICK → [PROCESSING(s)] → PLACE in modo semplice
            if inside_conditional and code.get("next") is not None:
                next_block = code["next"]["block"]
                
                # Raccoglie tutti i PROCESSING consecutivi
                while next_block is not None and next_block["type"] == StepsItems.PROCESSING.value:
                    action_data = loads(next_block["inputs"]["ACTION"]["block"]["data"])
                    action = actionsOfUser.filter(id=action_data["id"]).first()
                    action_points = loads(action.points)["points"]
                    actions_points_array.append(action_points)
                    
                    if next_block.get("next") is not None:
                        next_block = next_block["next"]["block"]
                    else:
                        next_block = None
                
                # Se troviamo un PLACE, prepara la location
                if next_block is not None and next_block["type"] == StepsItems.PLACE.value:
                    location_data = loads(next_block["inputs"]["LOCATION"]["block"]["data"])
                    location = locationsOfUser.filter(id=location_data["id"]).first()
                    location_sdf_filename = location.name
                    create_location_command = f"""gz service -s /world/worldCobotta/create --reqtype gz.msgs.EntityFactory --reptype gz.msgs.Boolean --timeout 5000 --req 'name: "location"; sdf_filename: "locations/{location_sdf_filename}/model.sdf"; pose: {{position: {{x: -8.8, y: -1.41, z: 1.065}}, orientation: {{x: 0, y: 0, z: 0, w: 0.7071}}}}'"""
                    if create_location_command:
                        launch_wsl_ros_command(create_location_command)
                
                # Esegue la sequenza fisica
                simulate_ros_pick()
                for action_points in actions_points_array:
                    simulate_ros_action(action_points)
                create_object_place_command = f"""gz service -s /world/worldCobotta/create --reqtype gz.msgs.EntityFactory --reptype gz.msgs.Boolean --timeout 5000 --req 'name: "object_place"; sdf_filename: "objects/{object_sdf_filename}/model.sdf"; pose: {{position: {{x: -9.16, y: -1.18, z: 1.25}}, orientation: {{x: 0, y: 0, z: 0, w: 1}}}}'"""
                simulate_ros_place(create_object_place_command)
                time.sleep(1)
                
                # NON facciamo la chiamata ricorsiva per next perché l'abbiamo già gestito sopra
                # (altrimenti il PLACE verrebbe eseguito due volte)
                return

            # Modalità normale (vecchio comportamento): lookahead automatico
            if code.get("next") is not None and code["next"]["block"]["type"] == StepsItems.PROCESSING.value:
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
                        create_location_command = f"""gz service -s /world/worldCobotta/create --reqtype gz.msgs.EntityFactory --reptype gz.msgs.Boolean --timeout 5000 --req 'name: "location"; sdf_filename: "locations/{location_sdf_filename}/model.sdf"; pose: {{position: {{x: -8.8, y: -1.41, z: 1.065}}, orientation: {{x: 0, y: 0, z: 0.7071, w: 0.7071}}}}'"""
                        launch_wsl_ros_command(create_location_command)
                        location_block_found = True

            if code.get("next") is not None and code["next"]["block"]["type"] == StepsItems.PLACE.value:
                location_data = loads(
                    code["next"]["block"]["inputs"]["LOCATION"]["block"]["data"]
                )
                location = locationsOfUser.filter(id=location_data["id"]).first()
                location_sdf_filename = location.name
                create_location_command = f"""gz service -s /world/worldCobotta/create --reqtype gz.msgs.EntityFactory --reptype gz.msgs.Boolean --timeout 5000 --req 'name: "location"; sdf_filename: "locations/{location_sdf_filename}/model.sdf"; pose: {{position: {{x: -8.8, y: -1.41, z: 1.065}}, orientation: {{x: 0, y: 0, z: 0.7071, w: 0.7071}}}}'"""
                launch_wsl_ros_command(create_location_command)

            simulate_ros_pick()
            for action_points in actions_points_array:
                simulate_ros_action(action_points)
            create_object_place_command = f"""gz service -s /world/worldCobotta/create --reqtype gz.msgs.EntityFactory --reptype gz.msgs.Boolean --timeout 5000 --req 'name: "object_place"; sdf_filename: "objects/{object_sdf_filename}/model.sdf"; pose: {{position: {{x: -9.16, y: -1.18, z: 1.25}}, orientation: {{x: 0, y: 0, z: 0, w: 1}}}}'"""
            simulate_ros_place(create_object_place_command)
            time.sleep(1)
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

                reset_simulation_world()

                simulation_recursive_blockly_parser(
                    code, objectsOfUser, actionsOfUser, locationsOfUser, simulate_event, inside_conditional=False
                )

                return success_response()
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))
