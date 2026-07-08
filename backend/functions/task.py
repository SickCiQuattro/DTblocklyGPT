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
import threading
import time
from dataclasses import dataclass
from typing import Any, Tuple

# All block type identifiers: shared source of truth
# NOTE: task.py still uses a fixed Pick→[Processing]→Place chain; the
# enums from block_types cover only the subset task.py currently handles.
from backend.block_types import (
    LogicItems,
    MacroItems,
    StepsItems,
    EventsItems,
)
from backend.functions.env_utils import get_bool_env

USE_HW_RECURSIVE_PARSER = get_bool_env("USE_HW_RECURSIVE_PARSER", default=False)
MAX_HW_LOOP_ITERATIONS = 100
HW_DEFAULT_GRIP_FORCE = 6


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


@dataclass
class HWContext:
    client: Any
    hCtrl: Any
    hRobot: Any
    ctrl: Any
    caoRobot: Any
    robot: Any
    stop_event: threading.Event


def _resolve_runtime_workspace(task: Task) -> dict | None:
    """
    Runtime read path (published-only):
    1. Normal task  → uses published_workspace, fallback to workspace, fallback to loads(code)
    2. Macro task   → uses ONLY published_workspace (never draft)

    Returns None if no workspace is available.
    """
    from json import loads as _loads

    if task.task_type == "macro_task":
        return task.published_workspace

    # normal Task — read chain with fallback legacy
    if task.published_workspace is not None:
        return task.published_workspace
    if task.workspace is not None:
        return task.workspace
    if task.code:
        try:
            return _loads(task.code)
        except (ValueError, TypeError):
            return None
    return None


def hardware_recursive_blockly_parser(
    code: dict,
    ctx: HWContext,
    objectsOfUser,
    actionsOfUser,
    locationsOfUser,
):
    if ctx.stop_event.is_set():
        return

    try:
        block_type = code["type"]

        def _next():
            if ctx.stop_event.is_set():
                return
            if code.get("next") is not None:
                hardware_recursive_blockly_parser(
                    code["next"]["block"], ctx,
                    objectsOfUser, actionsOfUser, locationsOfUser,
                )

        def _recurse(input_name: str):
            blk = code.get("inputs", {}).get(input_name, {}).get("block")
            if blk:
                hardware_recursive_blockly_parser(
                    blk, ctx, objectsOfUser, actionsOfUser, locationsOfUser,
                )

        def _safe_block_data(input_name: str, label: str):
            try:
                return loads(code["inputs"][input_name]["block"]["data"])
            except (KeyError, TypeError, ValueError) as exc:
                print(f"[HW] {label}: malformed block data, skipping: {exc}")
                return None

        def _hh_eval_condition(condition_block: dict) -> bool:
            if condition_block is None:
                return True
            btype = condition_block.get("type", "")
            inputs = condition_block.get("inputs", {})

            if btype == "logic_and_block":
                a = _hh_eval_condition(inputs.get("A", {}).get("block"))
                b = _hh_eval_condition(inputs.get("B", {}).get("block"))
                return a and b
            if btype == "logic_or_block":
                a = _hh_eval_condition(inputs.get("A", {}).get("block"))
                b = _hh_eval_condition(inputs.get("B", {}).get("block"))
                return a or b
            if btype == "logic_not_block":
                return not _hh_eval_condition(inputs.get("BOOL", {}).get("block"))

            if btype == EventsItems.FIND.value:
                try:
                    obj_data = loads(condition_block["inputs"]["OBJECT"]["block"]["data"])
                    obj = objectsOfUser.filter(id=obj_data["id"]).first()
                    find, _ = search_object(ctx.client, ctx.hRobot, obj, ctx.robot, 0)
                    return find
                except Exception as exc:
                    print(f"[HW] find_object condition error: {exc}")
                    return False
            if btype == EventsItems.GESTURE.value:
                print("[HW] gesture condition: confirmed by operator (webcam in UI)")
                return True
            if btype == EventsItems.TIMER.value:
                seconds = int(condition_block.get("fields", {}).get("SECONDS", 1))
                print(f"[HW] timer: {seconds}s")
                time.sleep(seconds)
                return True

            print(f"[HW] unknown condition: {btype} → True")
            return True

        # ── Logic / Control flow ──────────────────────────────────────────────

        def _hh_repeat():
            times = int(code["fields"]["times"])
            print(f"[HW] Repeat x{times}")
            for _ in range(times):
                if ctx.stop_event.is_set():
                    break
                _recurse("DO")
            _next()

        def _hh_repeat_until():
            print(f"[HW] Repeat-Until (max {MAX_HW_LOOP_ITERATIONS})")
            condition_block = code.get("inputs", {}).get("CONDITION", {}).get("block")
            for _ in range(MAX_HW_LOOP_ITERATIONS):
                if ctx.stop_event.is_set():
                    break
                _recurse("DO")
                if _hh_eval_condition(condition_block):
                    break
            _next()

        def _hh_when():
            condition_block = code["inputs"]["WHEN"]["block"]
            if _hh_eval_condition(condition_block):
                _recurse("DO")
            _next()

        def _hh_when_otherwise():
            condition_block = code["inputs"]["WHEN"]["block"]
            if _hh_eval_condition(condition_block):
                _recurse("DO")
            else:
                _recurse("OTHERWISE")
            _next()

        # ── Human actions ─────────────────────────────────────────────────────

        def _hh_human_action():
            task_desc = code.get("fields", {}).get("TASK_DESC", "No description")
            print(f"\n[HW] HUMAN ACTION: {task_desc}")
            confirm_event = code.get("inputs", {}).get("CONFIRM_EVENT", {}).get("block")
            if confirm_event:
                _hh_eval_condition(confirm_event)
            _next()

        def _hh_notify():
            task_desc = code.get("fields", {}).get("TASK_DESC", "No description")
            print(f"[HW] NOTIFY: {task_desc}")
            _next()

        # ── Robot step actions ────────────────────────────────────────────────

        def _hh_pick():
            object_data = _safe_block_data("OBJECT", "PICK")
            if object_data is None:
                _next()
                return
            obj = objectsOfUser.filter(id=object_data["id"]).first()
            obj_name = obj.name if obj else object_data.get("name", "unknown")
            print(f"[HW] PICK: {obj_name}")
            find, _ = search_object(ctx.client, ctx.hRobot, obj, ctx.robot, 0)
            if not find:
                raise RuntimeError(f"Object not found: {obj_name}")
            curr_pos = robot_getvar(ctx.client, ctx.hRobot, CURRENT_POSITION)
            curr_pos[2] = CALIBRATION_HEIGHT
            ctx.client.robot_move(ctx.hRobot, 2, list_to_string_position(curr_pos), HALF_SPEED)
            _next()

        def _hh_place():
            location_data = _safe_block_data("LOCATION", "PLACE")
            if location_data is None:
                _next()
                return
            location = locationsOfUser.filter(id=location_data["id"]).first()
            loc_name = location.name if location else location_data.get("name", "unknown")
            print(f"[HW] PLACE: {loc_name}")
            if location and location.position:
                pos = loads(location.position) if isinstance(location.position, str) else location.position
                ctx.client.robot_move(
                    ctx.hRobot, 1,
                    "@0 P(" + str(pos["X"]) + ", " + str(pos["Y"]) + ", " + str(pos["Z"])
                    + ", " + str(pos["RX"]) + ", " + str(pos["RY"]) + ", " + str(pos["RZ"])
                    + ", " + str(pos["FIG"]) + ")",
                    MAX_SPEED,
                )
                open_hand(ctx.client, ctx.hRobot, ctx.caoRobot, ctx.ctrl)
            else:
                print(f"[HW] PLACE: no position data for '{loc_name}'")
            _next()

        def _hh_processing():
            action_data = _safe_block_data("ACTION", "PROCESSING")
            if action_data is None:
                _next()
                return
            action = actionsOfUser.filter(id=action_data["id"]).first()
            action_name = action.name if action else action_data.get("name", "unknown")
            print(f"[HW] PROCESSING: {action_name}")
            if action and action.points:
                try:
                    action_points = loads(action.points)["points"]
                    for point in action_points:
                        ctx.client.robot_move(ctx.hRobot, 1, "@0 P(" + point + ")", MAX_SPEED)
                except Exception as exc:
                    print(f"[HW] PROCESSING: action points error: {exc}")
            _next()

        def _hh_move_to():
            location_data = _safe_block_data("LOCATION", "MOVE_TO")
            if location_data is None:
                _next()
                return
            location = locationsOfUser.filter(id=location_data.get("id")).first()
            loc_name = location_data.get("name", "Unknown")
            motion_type = code.get("fields", {}).get("MOTION_TYPE", "LINEAR")
            bcap_mode = 1 if motion_type == "JOINT" else 2
            print(f"[HW] MOVE_TO ({motion_type}) → {loc_name}")
            if location and location.position:
                pos = loads(location.position) if isinstance(location.position, str) else location.position
                ctx.client.robot_move(
                    ctx.hRobot, bcap_mode,
                    "@0 P(" + str(pos["X"]) + ", " + str(pos["Y"]) + ", " + str(pos["Z"])
                    + ", " + str(pos["RX"]) + ", " + str(pos["RY"]) + ", " + str(pos["RZ"])
                    + ", " + str(pos["FIG"]) + ")",
                    MAX_SPEED,
                )
            else:
                print(f"[HW] MOVE_TO: no position data for '{loc_name}'")
            _next()

        def _hh_gripper():
            state = code.get("fields", {}).get("GRIPPER_STATE", "CLOSE")
            if state == "OPEN":
                print("[HW] Gripper: OPEN")
                open_hand(ctx.client, ctx.hRobot, ctx.caoRobot, ctx.ctrl)
            else:
                print("[HW] Gripper: CLOSE")
                switch_bcap_to_orin(ctx.client, ctx.hRobot, ctx.caoRobot)
                ctx.ctrl.Execute(RobotAction.HAND_MOVE_H.value, [HW_DEFAULT_GRIP_FORCE, 1])
                switch_orin_to_bcap(ctx.client, ctx.hRobot, ctx.caoRobot)
            _next()

        def _hh_open_gripper():
            print("[HW] Gripper: OPEN")
            open_hand(ctx.client, ctx.hRobot, ctx.caoRobot, ctx.ctrl)
            _next()

        def _hh_close_gripper():
            print("[HW] Gripper: CLOSE")
            switch_bcap_to_orin(ctx.client, ctx.hRobot, ctx.caoRobot)
            ctx.ctrl.Execute(RobotAction.HAND_MOVE_H.value, [HW_DEFAULT_GRIP_FORCE, 1])
            switch_orin_to_bcap(ctx.client, ctx.hRobot, ctx.caoRobot)
            _next()

        def _hh_wait():
            seconds = int(code.get("fields", {}).get("SECONDS", 1))
            print(f"[HW] Wait {seconds}s")
            time.sleep(seconds)
            _next()

        def _hh_macro():
            try:
                macro_data = loads(code["data"])
            except (KeyError, TypeError, ValueError) as exc:
                print(f"[HW] MACRO: malformed block data, skipping: {exc}")
                _next()
                return
            macro_id = macro_data["id"]
            macro_name = macro_data.get("name", str(macro_id))
            print(f"[HW MACRO] Starting: {macro_name}")
            macro_task = Task.objects.filter(id=macro_id).first()
            if macro_task:
                macro_code = _resolve_runtime_workspace(macro_task)
                if macro_code:
                    hardware_recursive_blockly_parser(
                        macro_code, ctx,
                        objectsOfUser, actionsOfUser, locationsOfUser,
                    )
            print(f"[HW MACRO] Complete: {macro_name}")
            _next()

        HW_HANDLERS = {
            LogicItems.REPEAT.value: _hh_repeat,
            LogicItems.REPEAT_UNTIL.value: _hh_repeat_until,
            LogicItems.WHEN.value: _hh_when,
            LogicItems.WHEN_OTHERWISE.value: _hh_when_otherwise,
            StepsItems.HUMAN_ACTION.value: _hh_human_action,
            StepsItems.NOTIFY_ACTION.value: _hh_notify,
            StepsItems.PICK.value: _hh_pick,
            StepsItems.PLACE.value: _hh_place,
            StepsItems.PROCESSING.value: _hh_processing,
            StepsItems.MOVE_TO.value: _hh_move_to,
            StepsItems.GRIPPER.value: _hh_gripper,
            StepsItems.OPEN_GRIPPER.value: _hh_open_gripper,
            StepsItems.CLOSE_GRIPPER.value: _hh_close_gripper,
            StepsItems.WAIT.value: _hh_wait,
            MacroItems.MACRO_TASK.value: _hh_macro,
        }

        handler = HW_HANDLERS.get(block_type)
        if handler is not None:
            handler()
        else:
            print(f"[HW] Unknown block type: {block_type}")

    except Exception as exc:
        print(f"[HW ERROR] hardware_recursive_blockly_parser: {exc}")
        raise


def run_task(request: HttpRequest) -> HttpResponse:
    # Deprecated (2026-07): this legacy CAO/COM stack is Windows-only by
    # dependency (camera + gripper need win32com, not just an over-cautious
    # guard — see CLAUDE.md) and drives the arm from taught DB poses with no
    # IK, no twin, none of the hardening below simulate.py. Real-robot runs
    # now go through /api/task/simulate/ with driveHardware=true (same IK
    # pipeline as Simulation, plus the halt channel, abort-on-fault gates,
    # and encoder verification) — see DigitalTwinPanel's "Real robot" target.
    # Code below is left in place, unreachable, not deleted outright.
    return error_response(
        "This endpoint is deprecated. Real-robot runs go through "
        "/api/task/simulate/ with driveHardware=true.",
        status=410,
    )
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
                    if CoInitialize is None or Dispatch is None:
                        return error_response("Robot hardware control requires Windows with CAO/DENSO drivers (not available on Linux/Mac)")
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
                    # ── Gate fully-published-only: a task with a pending draft
                    # (published_with_draft) must NOT drive the robot, since the
                    # runtime workspace is the last published version and would
                    # not match the draft the operator is currently editing.
                    if task.status != "published":
                        return error_response(
                            "Only a fully published task can drive the robot. "
                            "Publish or discard the current draft first."
                        )

                    code = _resolve_runtime_workspace(task)
                    if code is None:
                        return error_response("No published workspace available")

                    if USE_HW_RECURSIVE_PARSER:
                        (client, hCtrl, hRobot) = connect(robot.ip, robot.port, DEFAULT_TIMEOUT)
                        ctx = HWContext(
                            client=client,
                            hCtrl=hCtrl,
                            hRobot=hRobot,
                            ctrl=ctrl,
                            caoRobot=caoRobot,
                            robot=robot,
                            stop_event=threading.Event(),
                        )
                        move_to_calibration_position(client, hRobot)
                        open_hand(client, hRobot, caoRobot, ctrl)
                        try:
                            if isinstance(code, list):
                                for block in code:
                                    hardware_recursive_blockly_parser(
                                        block, ctx,
                                        objectsOfUser, actionsOfUser, locationsOfUser,
                                    )
                            else:
                                hardware_recursive_blockly_parser(
                                    code, ctx,
                                    objectsOfUser, actionsOfUser, locationsOfUser,
                                )
                        finally:
                            disconnect(client, hCtrl, hRobot)
                    else:
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

                # validate the robot exists (raises DoesNotExist → caught below)
                UserRobot.objects.get(id=my_robot_id)

                if task.status not in ("published", "published_with_draft"):
                    return error_response("Task not published")

                code = _resolve_runtime_workspace(task)
                if code is None:
                    return error_response("No published workspace available")

                return success_response()
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))
