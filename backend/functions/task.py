from math import inf
from django.http import HttpResponse, HttpRequest
from backend.utils.response import (
    HttpMethod,
    invalid_request_method,
    error_response,
    success_response,
    unauthorized_request,
)
from backend.models import Task, Object, UserRobot, Location, Action, Robot
from json import loads
from django.db.models import Q
from enum import Enum

import sys
if sys.platform == 'win32':
    from pythoncom import CoInitialize
else:
    CoInitialize = None

from backend.functions.robot import (
    connect,
    disconnect,
    check_ip_response,
    DEFAULT_TIMEOUT,
    move_to_calibration_position,
    CaoParams,
    RobotAction,
    imread_base64,
    robot_getvar,
    CURRENT_POSITION,
    CURRENT_ANGLE,
    MAX_SPEED,
    acquire_photo,
    find_polar_coordinates,
    find_orientation,
    list_to_string_joints,
    polar_to_robot_coordinates,
    list_to_string_position,
    HALF_SPEED,
    switch_bcap_to_orin,
    switch_orin_to_bcap,
    INITIAL_POSITION,
    open_hand,
    CALIBRATION_HEIGHT,
)

import sys
if sys.platform == 'win32':
    from win32com.client import Dispatch
else:
    Dispatch = None

from ..pybcapclient.bcapclient import BCAPClient
import cv2
from numpy import zeros
from typing import Tuple


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


class ActionPatterns(Enum):
    LINEAR = "L"
    CIRCULAR = "C"
    CROSS = "X"


ACTION_PATTERN_LINEAR_POINTS = {
    "points": [
        '{"X": 0, "Y": 0, "Z": 0, "RX": 0, "RY": 0, "RZ": 0, "FIG": 0}',
        '{"X": 0, "Y": 0, "Z": 0, "RX": 0, "RY": 0, "RZ": 0, "FIG": 0}',
    ]
}
ACTION_PATTERN_CIRCULAR_POINTS = {
    "points": [
        '{"X": 0, "Y": 0, "Z": 0, "RX": 0, "RY": 0, "RZ": 0, "FIG": 0}',
        '{"X": 0, "Y": 0, "Z": 0, "RX": 0, "RY": 0, "RZ": 0, "FIG": 0}',
    ]
}
ACTION_PATTERN_CROSS_POINTS = {
    "points": [
        '{"X": 0, "Y": 0, "Z": 0, "RX": 0, "RY": 0, "RZ": 0, "FIG": 0}',
        '{"X": 0, "Y": 0, "Z": 0, "RX": 0, "RY": 0, "RZ": 0, "FIG": 0}',
    ]
}


def run_task(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                task_id = data.get("id")
                my_robot_id = data.get("robot")
                sensorhuman = data.get("sensorhuman")
                task = Task.objects.filter(id=task_id).first()
                if task is None:
                    return error_response("Task not found")

                robot = UserRobot.objects.get(id=my_robot_id).robot

                if check_ip_response(robot.ip, robot.port):
                    CoInitialize()
                    eng = Dispatch(CaoParams.ENGINE.value)
                    ctrl = eng.Workspaces(0).AddController(
                        "", CaoParams.RC8.value, "", "Server=" + str(robot.ip)
                    )
                    caoRobot = ctrl.AddRobot(RobotAction.ROBOT_0.value, "")

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
                    condition_not_met = False
                    object_not_found = False

                    # First level logic
                    if code["type"] == LogicItems.REPEAT.value:
                        object_not_found = repeat_loop_workflow(
                            code,
                            objectsOfUser,
                            actionsOfUser,
                            locationsOfUser,
                            robot,
                            caoRobot,
                            ctrl,
                        )

                    elif code["type"] == LogicItems.LOOP.value:
                        object_not_found = repeat_loop_workflow(
                            code,
                            objectsOfUser,
                            actionsOfUser,
                            locationsOfUser,
                            robot,
                            caoRobot,
                            ctrl,
                            loop=True,
                        )

                    elif code["type"] == LogicItems.WHEN.value:
                        object_not_found, condition_not_met = when_otherwise_workflow(
                            code,
                            objectsOfUser,
                            actionsOfUser,
                            locationsOfUser,
                            robot,
                            caoRobot,
                            ctrl,
                            sensorhuman,
                        )

                    elif code["type"] == LogicItems.WHEN_OTHERWISE.value:
                        object_not_found, condition_not_met = when_otherwise_workflow(
                            code,
                            objectsOfUser,
                            actionsOfUser,
                            locationsOfUser,
                            robot,
                            caoRobot,
                            ctrl,
                            sensorhuman,
                            otherwise=True,
                        )

                    if condition_not_met:
                        return error_response("Condition not met")

                    if object_not_found:
                        return error_response("Object not found")

                else:
                    return error_response("Robot not connected")

                return success_response()
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def repeat_loop_workflow(
    code: any,
    objectsOfUser: list[Object],
    actionsOfUser: list[Action],
    locationsOfUser: list[Location],
    robot: Robot,
    caoRobot: any,
    ctrl: any,
    loop: bool = False,
) -> bool:
    times = inf
    action = None
    if not loop:
        times = int(code["fields"]["times"])

    if code["inputs"]["DO"]["block"]["type"] == StepsItems.PICK.value:
        object_data = loads(
            code["inputs"]["DO"]["block"]["inputs"]["OBJECT"]["block"]["data"]
        )
        object = objectsOfUser.filter(id=object_data["id"]).first()

        if (
            code["inputs"]["DO"]["block"]["next"]["block"]["type"]
            == StepsItems.PROCESSING.value
        ):
            action_data = loads(
                code["inputs"]["DO"]["block"]["next"]["block"]["inputs"]["ACTION"][
                    "block"
                ]["data"]
            )
            action = actionsOfUser.filter(id=action_data["id"]).first()
            if (
                code["inputs"]["DO"]["block"]["next"]["block"]["next"]["block"]["type"]
                == StepsItems.PLACE.value
            ):
                location_data = loads(
                    code["inputs"]["DO"]["block"]["next"]["block"]["next"]["block"][
                        "inputs"
                    ]["LOCATION"]["block"]["data"]
                )
                location = locationsOfUser.filter(id=location_data["id"]).first()

        elif (
            code["inputs"]["DO"]["block"]["next"]["block"]["type"]
            == StepsItems.PLACE.value
        ):
            location_data = loads(
                code["inputs"]["DO"]["block"]["next"]["block"]["inputs"]["LOCATION"][
                    "block"
                ]["data"]
            )
            location = locationsOfUser.filter(id=location_data["id"]).first()

    if times is not None and object is not None and location is not None:
        (client, hCtrl, hRobot) = connect(robot.ip, robot.port, DEFAULT_TIMEOUT)
        move_to_calibration_position(client, hRobot)
        open_hand(client, hRobot, caoRobot, ctrl)

        i = 0
        lastFind = 0
        while i < times:
            find, lastFind = search_object(
                client,
                hRobot,
                object,
                robot,
                lastFind,
            )

            if find:
                i = i + 1

                curr_pos = robot_getvar(client, hRobot, CURRENT_POSITION)
                curr_pos[2] = CALIBRATION_HEIGHT
                client.robot_move(
                    hRobot,
                    2,
                    list_to_string_position(curr_pos),
                    HALF_SPEED,
                )

                # move_to_calibration_position(client, hRobot)

                if action is not None:
                    action_points = None

                    if action.pattern == ActionPatterns.LINEAR.value:
                        action_points = loads(ACTION_PATTERN_LINEAR_POINTS)["points"]
                    elif action.pattern == ActionPatterns.CIRCULAR.value:
                        action_points = loads(ACTION_PATTERN_CIRCULAR_POINTS)["points"]
                    elif action.pattern == ActionPatterns.CROSS.value:
                        action_points = loads(ACTION_PATTERN_CROSS_POINTS)["points"]
                    else:
                        action_points = loads(action.points)["points"]

                    for x in range(0, len(action_points)):
                        client.robot_move(
                            hRobot,
                            1,
                            "@0 P(" + action.points[x] + ")",
                            MAX_SPEED,
                        )

                # move_to_calibration_position(client, hRobot)
                location_position = loads(location.position)
                client.robot_move(
                    hRobot,
                    1,
                    "@0 P("
                    + str(location_position["X"])
                    + ", "
                    + str(location_position["Y"])
                    + ", "
                    + str(location_position["Z"])
                    + ", "
                    + str(location_position["RX"])
                    + ", "
                    + str(location_position["RY"])
                    + ", "
                    + str(location_position["RZ"])
                    + ", "
                    + str(location_position["FIG"])
                    + ")",
                    MAX_SPEED,
                )

                open_hand(client, hRobot, caoRobot, ctrl)
            else:
                disconnect(client, hCtrl, hRobot)
                return True

        # move_to_calibration_position(client, hRobot)
        disconnect(client, hCtrl, hRobot)
        return False


def when_otherwise_workflow(
    code: any,
    objectsOfUser: list[Object],
    actionsOfUser: list[Action],
    locationsOfUser: list[Location],
    robot: Robot,
    caoRobot: any,
    ctrl: any,
    sensorhuman: bool,
    otherwise: bool = False,
) -> Tuple[bool, bool]:
    result = {
        "object_not_found": False,
        "condition_not_met": False,
    }

    when_condition = int(code["inputs"]["WHEN"]["block"]["fields"])

    if otherwise:
        if code["inputs"]["OTHERWISE"]["block"]["type"] == StepsItems.PICK.value:
            object_otherwise_data = loads(
                code["inputs"]["OTHERWISE"]["block"]["inputs"]["OBJECT"]["block"][
                    "data"
                ]
            )
            object_otherwise = objectsOfUser.filter(
                id=object_otherwise_data["id"]
            ).first()

            if (
                code["inputs"]["OTHERWISE"]["block"]["next"]["block"]["type"]
                == StepsItems.PROCESSING.value
            ):
                action_otherwise_data = loads(
                    code["inputs"]["OTHERWISE"]["block"]["next"]["block"]["inputs"][
                        "ACTION"
                    ]["block"]["data"]
                )
                action_otherwise = actionsOfUser.filter(
                    id=action_otherwise_data["id"]
                ).first()
                if (
                    code["inputs"]["OTHERWISE"]["block"]["next"]["block"]["next"][
                        "block"
                    ]["type"]
                    == StepsItems.PLACE.value
                ):
                    location_otherwise_data = loads(
                        code["inputs"]["OTHERWISE"]["block"]["next"]["block"]["next"][
                            "block"
                        ]["inputs"]["LOCATION"]["block"]["data"]
                    )
                    location_otherwise = locationsOfUser.filter(
                        id=location_otherwise_data["id"]
                    ).first()

            elif (
                code["inputs"]["OTHERWISE"]["block"]["next"]["block"]["type"]
                == StepsItems.PLACE.value
            ):
                location_otherwise_data = loads(
                    code["inputs"]["OTHERWISE"]["block"]["next"]["block"]["inputs"][
                        "LOCATION"
                    ]["block"]["data"]
                )
                location_otherwise = locationsOfUser.filter(
                    id=location_otherwise_data["id"]
                ).first()

    if code["inputs"]["DO"]["block"]["type"] == StepsItems.PICK.value:
        object_data = loads(
            code["inputs"]["DO"]["block"]["inputs"]["OBJECT"]["block"]["data"]
        )
        object = objectsOfUser.filter(id=object_data["id"]).first()

        if (
            code["inputs"]["DO"]["block"]["next"]["block"]["type"]
            == StepsItems.PROCESSING.value
        ):
            action_data = loads(
                code["inputs"]["DO"]["block"]["next"]["block"]["inputs"]["ACTION"][
                    "block"
                ]["data"]
            )
            action = actionsOfUser.filter(id=action_data["id"]).first()
            if (
                code["inputs"]["DO"]["block"]["next"]["block"]["next"]["block"]["type"]
                == StepsItems.PLACE.value
            ):
                location_data = loads(
                    code["inputs"]["DO"]["block"]["next"]["block"]["next"]["block"][
                        "inputs"
                    ]["LOCATION"]["block"]["data"]
                )
                location = locationsOfUser.filter(id=location_data["id"]).first()

        elif (
            code["inputs"]["DO"]["block"]["next"]["block"]["type"]
            == StepsItems.PLACE.value
        ):
            location_data = loads(
                code["inputs"]["DO"]["block"]["next"]["block"]["inputs"]["LOCATION"][
                    "block"
                ]["data"]
            )
            location = locationsOfUser.filter(id=location_data["id"]).first()

    if when_condition is not None and object is not None and location is not None:
        (client, hCtrl, hRobot) = connect(robot.ip, robot.port, DEFAULT_TIMEOUT)
        move_to_calibration_position(client, hRobot)
        open_hand(client, hRobot, caoRobot, ctrl)

        if (
            when_condition == EventsItems.SENSOR.value
            or when_condition == EventsItems.HUMAN.value
        ):
            if sensorhuman:
                pass
            else:
                disconnect(client, hCtrl, hRobot)
                result["condition_not_met"] = True
                return result
        elif when_condition == EventsItems.FIND.value:
            object_to_find_data = loads(
                code["inputs"]["WHEN"]["block"]["inputs"]["OBJECT"]["block"]["data"]
            )
            object_to_find = objectsOfUser.filter(id=object_to_find_data["id"]).first()
            find, _ = search_object(
                client,
                hRobot,
                object_to_find,
                robot,
                lastFind=0,
            )
            if not find:
                if not otherwise:
                    disconnect(client, hCtrl, hRobot)
                    result["condition_not_met"] = True
                    return result
                else:
                    find, _ = search_object(
                        client,
                        hRobot,
                        object_otherwise,
                        robot,
                        lastFind=0,
                    )

                    if find:
                        curr_pos = robot_getvar(client, hRobot, CURRENT_POSITION)
                        curr_pos[2] = CALIBRATION_HEIGHT
                        client.robot_move(
                            hRobot,
                            2,
                            list_to_string_position(curr_pos),
                            HALF_SPEED,
                        )

                        # move_to_calibration_position(client, hRobot)

                        if action_otherwise is not None:
                            action_otherwise_points = None

                            if action_otherwise.pattern == ActionPatterns.LINEAR.value:
                                action_otherwise_points = loads(
                                    ACTION_PATTERN_LINEAR_POINTS
                                )["points"]
                            elif (
                                action_otherwise.pattern
                                == ActionPatterns.CIRCULAR.value
                            ):
                                action_otherwise_points = loads(
                                    ACTION_PATTERN_CIRCULAR_POINTS
                                )["points"]
                            elif action_otherwise.pattern == ActionPatterns.CROSS.value:
                                action_otherwise_points = loads(
                                    ACTION_PATTERN_CROSS_POINTS
                                )["points"]
                            else:
                                action_otherwise_points = loads(
                                    action_otherwise.points
                                )["points"]

                            for x in range(0, len(action_otherwise_points)):
                                client.robot_move(
                                    hRobot,
                                    1,
                                    "@0 P(" + action_otherwise.points[x] + ")",
                                    MAX_SPEED,
                                )

                        # move_to_calibration_position(client, hRobot)

                        client.robot_move(
                            hRobot,
                            1,
                            "@0 P("
                            + str(location_otherwise.position["X"])
                            + ", "
                            + str(location_otherwise.position["Y"])
                            + ", "
                            + str(location_otherwise.position["Z"])
                            + ", "
                            + str(location_otherwise.position["RX"])
                            + ", "
                            + str(location_otherwise.position["RY"])
                            + ", "
                            + str(location_otherwise.position["RZ"])
                            + ", "
                            + str(location_otherwise.position["FIG"])
                            + ")",
                            MAX_SPEED,
                        )

                        open_hand(client, hRobot, caoRobot, ctrl)
                    else:
                        disconnect(client, hCtrl, hRobot)
                        result["object_not_found"] = True
                        return result

        # elif when_condition == EventsItems.DETECT.value:
        #    pass

        find, _ = search_object(
            client,
            hRobot,
            object,
            robot,
            lastFind=0,
        )

        if find:
            curr_pos = robot_getvar(client, hRobot, CURRENT_POSITION)
            curr_pos[2] = CALIBRATION_HEIGHT
            client.robot_move(
                hRobot,
                2,
                list_to_string_position(curr_pos),
                HALF_SPEED,
            )

            # move_to_calibration_position(client, hRobot)

            if action is not None:
                action_points = None

                if action.pattern == ActionPatterns.LINEAR.value:
                    action_points = loads(ACTION_PATTERN_LINEAR_POINTS)["points"]
                elif action.pattern == ActionPatterns.CIRCULAR.value:
                    action_points = loads(ACTION_PATTERN_CIRCULAR_POINTS)["points"]
                elif action.pattern == ActionPatterns.CROSS.value:
                    action_points = loads(ACTION_PATTERN_CROSS_POINTS)["points"]
                else:
                    action_points = loads(action.points)["points"]

                for x in range(0, len(action_points)):
                    client.robot_move(
                        hRobot,
                        1,
                        "@0 P(" + action.points[x] + ")",
                        MAX_SPEED,
                    )

            # move_to_calibration_position(client, hRobot)
            location_position = loads(location.position)
            client.robot_move(
                hRobot,
                1,
                "@0 P("
                + str(location_position["X"])
                + ", "
                + str(location_position["Y"])
                + ", "
                + str(location_position["Z"])
                + ", "
                + str(location_position["RX"])
                + ", "
                + str(location_position["RY"])
                + ", "
                + str(location_position["RZ"])
                + ", "
                + str(location_position["FIG"])
                + ")",
                MAX_SPEED,
            )

            open_hand(client, hRobot, caoRobot, ctrl)
        else:
            disconnect(client, hCtrl, hRobot)
            result["object_not_found"] = True
            return result

        # move_to_calibration_position(client, hRobot)
        disconnect(client, hCtrl, hRobot)
        return result


def search_object(
    client: BCAPClient, hRobot: any, object: Object, robot: Robot, lastFind: int = 0
) -> Tuple[bool, int]:
    DISTANCE_MAX = 0.075
    DIFF_AREA_MAX = 40000
    move = 0
    find = False
    pos = lastFind

    # Quadrants used to search for object
    Q0 = INITIAL_POSITION
    Q1 = "@0 P(124.8479084757812, 96.71132432510223, 254.93505849932905, 179.98326477675423, -0.021660598353600596, 179.9971873030206, 261.0)"
    Q2 = "@0 P(201.62729889242553, 96.71465770886049, 254.9352502844515, 179.98348831787996, -0.021534861588810798, 179.99838567272027, 261.0)"
    Q3 = "@0 P(222.45008156262494, -28.895388040937206, 254.9197279214668, 179.9806000045344, -0.029053337503689936, 179.98516581416754, 261.0)"
    Q4 = "@0 P(217.31049652044388, -130.24508774032034, 254.89685566528902, 179.9716479887839, -0.03128951339508686, 179.98066547808395, 261.0)"
    Q5 = "@0 P(133.63413919141982, -131.393237172843, 254.87885013312, 179.9599341526348, -0.027773416827480392, 179.97129867455095, 261.0)"
    Q = [Q0, Q1, Q2, Q3, Q4, Q5]

    eng = Dispatch(CaoParams.ENGINE.value)
    ctrl = eng.Workspaces(0).AddController(
        "", CaoParams.RC8.value, "", "Server=" + str(robot.ip)
    )

    caoRobot = ctrl.AddRobot(RobotAction.ROBOT_0.value, "")

    original = imread_base64(object.shape)

    (cnts, _) = cv2.findContours(
        original.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE
    )

    areaOriginal = cv2.contourArea(cnts[0])

    while find is False and move < 6:
        client.robot_move(hRobot, 1, Q[pos], MAX_SPEED)

        curr_pos = robot_getvar(client, hRobot, CURRENT_POSITION)
        curr_joints = robot_getvar(client, hRobot, CURRENT_ANGLE)
        curr_angle = -curr_joints[0]
        curr_x = curr_pos[0]
        curr_y = curr_pos[1]

        photo = acquire_photo(wb=True, cameraip=robot.cameraip)

        shifted = cv2.pyrMeanShiftFiltering(photo, 51, 71)
        gray = cv2.cvtColor(shifted, cv2.COLOR_BGR2GRAY)
        thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
        (cnts, _) = cv2.findContours(
            thresh.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE
        )

        areaMax = 0
        areaMaxi = -1

        for i, cnt in enumerate(cnts):
            area = cv2.contourArea(cnt)
            if areaMax < area:
                areaMax = area
                areaMaxi = i

        diff_area = abs(areaMax - areaOriginal)
        if diff_area > DIFF_AREA_MAX:
            move = move + 1
            pos = pos + 1
            if pos == 6:
                pos = 0
            continue

        outline = zeros(photo.shape, dtype="uint8")
        (x, y, width, height) = cv2.boundingRect(cnts[areaMaxi])
        cv2.drawContours(outline, cnts, areaMaxi, (255, 255, 255), -1)
        roi = outline[y : y + height, x : x + width]
        roi = cv2.copyMakeBorder(roi, 15, 15, 15, 15, cv2.BORDER_CONSTANT, value=0)

        photo_grey = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        d2 = cv2.matchShapes(original, photo_grey, cv2.CONTOURS_MATCH_I2, 0)
        if abs(d2) < DISTANCE_MAX:
            find = True
            # convert the grayscale image to binary image
            # ret, thresh = cv2.threshold(gray, 127, 255, 0)

            # calculate moments of binary image
            M = cv2.moments(cnts[areaMaxi])

            # calculate x,y coordinate of center
            cX = int(M["m10"] / M["m00"])
            cY = int(M["m01"] / M["m00"])

            # put text and highlight the center
            # cv2.circle(photo, (cX, cY), 5, (0, 0, 255), -1)

            (module, angle) = find_polar_coordinates(curr_angle, cX, cY)

            new_angle = find_orientation(cnts[areaMaxi], curr_angle)
            curr_joints = robot_getvar(client, hRobot, CURRENT_ANGLE)
            curr_joints[5] = new_angle + curr_joints[0]
            client.robot_move(hRobot, 1, list_to_string_joints(curr_joints))

            (shape_x, shape_y) = polar_to_robot_coordinates(
                angle, curr_x, curr_y, module
            )
            curr_pos = robot_getvar(client, hRobot, CURRENT_POSITION)
            curr_pos[0] = shape_x
            curr_pos[1] = shape_y
            client.robot_move(hRobot, 2, list_to_string_position(curr_pos), MAX_SPEED)

            curr_pos[2] = object.height
            client.robot_move(hRobot, 2, list_to_string_position(curr_pos), HALF_SPEED)

            switch_bcap_to_orin(client, hRobot, caoRobot)

            # HandMoveH (force (min 6, max 20), direction (1 closing)
            ctrl.Execute(RobotAction.HAND_MOVE_H.value, [object.force * 6, 1])
            switch_orin_to_bcap(client, hRobot, caoRobot)
            break
        else:
            move = move + 1
            pos = pos + 1
            if pos == 6:
                pos = 0
    return find, pos


def analyze_task(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                task_id = data.get("id")
                my_robot_id = data.get("robot")
                task = Task.objects.filter(id=task_id).first()
                if task is None:
                    return error_response("Task not found")

                robot = UserRobot.objects.get(id=my_robot_id).robot

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

                return success_response()
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))
