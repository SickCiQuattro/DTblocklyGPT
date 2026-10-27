from numpy import array
from ..pybcapclient.bcapclient import BCAPClient

import sys
if sys.platform == 'win32':
    from win32com.client import Dispatch
    from pythoncom import CoInitialize
else:
    Dispatch = None
    CoInitialize = None

from PIL import Image
from io import BytesIO
import cv2

from enum import Enum
from backend.utils.response import (
    HttpMethod,
    invalid_request_method,
    error_response,
    success_response,
    unauthorized_request,
)
from django.http import HttpResponse, HttpRequest
from json import loads
from backend.models import UserRobot, Robot
from numpy import zeros
from base64 import b64encode
import socket


BCAP_MACHINE_NAME = "localhost"


class CaoParams(Enum):
    VRC = "CaoProv.DENSO.VRC"
    ENGINE = "CAO.CaoEngine"
    CANON_CAMERA = "CaoProv.Canon.N10-W02"
    RC8 = "CaoProv.DENSO.RC8"


class RobotAction(Enum):
    MOTOR = "Motor"
    GIVE_ARM = "GiveArm"
    TAKE_ARM = "TakeArm"
    ARM_0 = "Arm0"
    CUR_JOINT = "CurJnt"
    HAND_POS = "HandCurPos"


class CameraAction(Enum):
    ONE_SHOT_WHITE_BALANCE = "OneShotWhiteBalance"
    ONE_SHOT_FOCUS = "OneShotFocus"


INITIAL_POSITION = """@0 P(177.483268825558, -44.478627592948996, 254.99815172770593, -179.98842099994923, 0,
                                    179.99584205147127, 261.0)"""
CURRENT_POSITION = "@CURRENT_POSITION"
DEFAULT_TIMEOUT = 14400
MAX_SPEED = "SPEED=100"


def robot_take_arm(client, hRobot):
    client.robot_execute(hRobot, RobotAction.TAKE_ARM.value, [0, 0])


def robot_give_arm(client, hRobot):
    client.robot_execute(hRobot, RobotAction.GIVE_ARM.value)


def robot_motor(client, hRobot):
    client.robot_execute(hRobot, RobotAction.MOTOR.value, [1, 0])


def connect(host, port, timeout, provider=CaoParams.VRC.value):
    client = BCAPClient(host, port, timeout)
    client.service_start("")
    Name = ""
    Provider = provider
    Machine = BCAP_MACHINE_NAME
    Option = ""
    hCtrl = client.controller_connect(Name, Provider, Machine, Option)
    hRobot = client.controller_getrobot(hCtrl, RobotAction.ARM_0.value)
    robot_take_arm(client, hRobot)
    robot_motor(client, hRobot)
    return (client, hCtrl, hRobot)


def disconnect(client, hCtrl, hRobot):
    robot_motor(client, hRobot)
    robot_give_arm(client, hRobot)
    client.controller_disconnect(hCtrl)
    client.service_stop()


def robot_getvar(client, hRobot, name):
    assert isinstance(client, BCAPClient)
    var_handle = client.robot_getvariable(hRobot, name)
    value = client.variable_getvalue(var_handle)
    client.variable_release(var_handle)
    return value


def acquire_photo(CVconv=True, wb=False, oneshotfocus=False, cameraip=0):
    if Dispatch is None:
        raise RuntimeError("acquire_photo: CAO/DENSO drivers only available on Windows")
    eng = Dispatch(CaoParams.ENGINE.value)
    ctrl = eng.Workspaces(0).AddController(
        "",
        CaoParams.CANON_CAMERA.value,
        "",
        "Server=" + str(cameraip) + ", Timeout=5000",
    )
    image_handle = ctrl.AddVariable("IMAGE")
    try:
        if wb:
            ctrl.Execute(CameraAction.ONE_SHOT_WHITE_BALANCE.value)
        if oneshotfocus:
            ctrl.Execute(CameraAction.ONE_SHOT_FOCUS.value)
        image = image_handle.Value
        stream = BytesIO(image)
        img = Image.open(stream)
        opencvImage = cv2.cvtColor(array(img), cv2.COLOR_RGB2BGR)
        return opencvImage if CVconv else img
    finally:
        # Release COM handles even if capture/decoding raises above.
        del image_handle
        del ctrl
        del eng


def get_photo(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                robot_id = data.get("robot")
                user_robot = UserRobot.objects.get(id=robot_id)
                robot = Robot.objects.get(id=user_robot.robot.id)
                if check_ip_response(robot.ip, robot.port):
                    if CoInitialize is None or Dispatch is None:
                        return error_response("Robot hardware control requires Windows with CAO/DENSO drivers (not available on Linux/Mac)")
                    CoInitialize()
                    handles = connect(robot.ip, robot.port, DEFAULT_TIMEOUT)
                    client = handles[0]
                    hCtrl = handles[1]
                    hRobot = handles[2]
                    move_to_calibration_position(client, hRobot)
                    disconnect(client, hCtrl, hRobot)
                    image = acquire_photo(wb=True, cameraip=robot.cameraip)

                    # Photo
                    _, photo_buffer = cv2.imencode(".png", image)
                    photo = b64encode(photo_buffer).decode("utf-8")

                    # Contour
                    shifted = cv2.pyrMeanShiftFiltering(image, 51, 71)
                    gray = cv2.cvtColor(shifted, cv2.COLOR_BGR2GRAY)
                    thresh = cv2.threshold(
                        gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU
                    )[1]
                    (cnts, _) = cv2.findContours(
                        thresh.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE
                    )

                    # Guard: no contours means nothing was detected — avoid an
                    # IndexError on cnts[areaMaxi] below (areaMaxi would stay -1).
                    if not cnts:
                        return error_response("No object detected in the image")

                    areaMax = 0
                    areaMaxi = -1

                    for i, cnt in enumerate(cnts):
                        area = cv2.contourArea(cnt)
                        if areaMax < area:
                            areaMax = area
                            areaMaxi = i

                    contour_image = image.copy()
                    cv2.drawContours(contour_image, cnts, areaMaxi, (0, 0, 255), 3)
                    _, contour_buffer = cv2.imencode(".png", contour_image)
                    contour = b64encode(contour_buffer).decode("utf-8")

                    # Shape
                    outline = zeros(image.shape, dtype="uint8")
                    (x, y, width, height) = cv2.boundingRect(cnts[areaMaxi])
                    cv2.drawContours(outline, cnts, areaMaxi, (255, 255, 255), -1)
                    roi = outline[y : y + height, x : x + width]
                    shape_image = cv2.copyMakeBorder(
                        roi, 15, 15, 15, 15, cv2.BORDER_CONSTANT, value=0
                    )
                    _, shape_buffer = cv2.imencode(".png", shape_image)
                    shape = b64encode(shape_buffer).decode("utf-8")

                    response = {}
                    response["photo"] = photo
                    response["contour"] = contour
                    response["shape"] = shape
                    return success_response(response)
                else:
                    return error_response(str("Robot not connected"))
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def get_current_joints(client, hRobot):
    return client.robot_execute(hRobot, RobotAction.CUR_JOINT.value)[0:6]


def get_hand_position(client, hCtrl):
    return client.controller_execute(hCtrl, RobotAction.HAND_POS.value)


def get_cartesian_position(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                robot_id = data.get("robot")
                user_robot = UserRobot.objects.get(id=robot_id)
                robot = Robot.objects.get(id=user_robot.robot.id)
                if check_ip_response(robot.ip, robot.port):
                    (client, hCtrl, hRobot) = connect(robot.ip, robot.port, 14400)
                    curr_pos = robot_getvar(client, hRobot, CURRENT_POSITION)
                    position = {
                        "X": +curr_pos[0],
                        "Y": +curr_pos[1],
                        "Z": +curr_pos[2],
                        "RX": +curr_pos[3],
                        "RY": +curr_pos[4],
                        "RZ": +curr_pos[5],
                        "FIG": +curr_pos[6],
                    }
                    disconnect(client, hCtrl, hRobot)
                    response = {"position": position}
                    return success_response(response)
                else:
                    return error_response(str("Robot not connected"))
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def get_joint_position(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                robot_id = data.get("robot")
                user_robot = UserRobot.objects.get(id=robot_id)
                robot = Robot.objects.get(id=user_robot.robot.id)
                if check_ip_response(robot.ip, robot.port):
                    (client, hCtrl, hRobot) = connect(robot.ip, robot.port, 14400)
                    joint_position = get_current_joints(client, hRobot)
                    hand_position = get_hand_position(client, hCtrl)
                    position = {
                        "j1": joint_position[0],
                        "j2": joint_position[1],
                        "j3": joint_position[2],
                        "j4": joint_position[3],
                        "j5": joint_position[4],
                        "j6": joint_position[5],
                        "hand": hand_position,
                    }
                    disconnect(client, hCtrl, hRobot)
                    response = {"position": position}
                    return success_response(response)
                else:
                    return error_response(str("Robot not connected"))
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def ping_ip(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                ip = data.get("ip")
                port = data.get("port", 80)
                if check_ip_response(ip, int(port)):
                    return success_response()
                else:
                    return error_response(str("Robot not connected"))
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def check_ip_response(ip_address, port=80):
    try:
        # Create a socket object
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

        # Set a timeout value in seconds
        sock.settimeout(1)

        # Try to connect to the IP address and port 80
        result = sock.connect_ex((ip_address, port))

        # Check if the connection was successful
        if result == 0:
            return True
        else:
            return False

    except socket.error:
        return False
    finally:
        # Close the socket
        sock.close()


def move_to_calibration_position(client: BCAPClient, hRobot):
    client.robot_move(
        hRobot,
        1,
        INITIAL_POSITION,
        MAX_SPEED,
    )
