from sensor_msgs.msg import JointState
from flask import Blueprint, request, jsonify

from ..db import get_db
from ..flask_node import flask_pub
from ..flask_node import sendRequestPosition
from ..cobotta_utils import JOINT_LIMITS_DEG

import time


bp = Blueprint("api", __name__, url_prefix="/api")

MAX_WAYPOINTS = 5000

# Bounds for caller-supplied vision-wait timeouts (seconds).
MIN_WAIT_TIMEOUT_S = 0.1
MAX_WAIT_TIMEOUT_S = 300.0


def _clamp(value, lo, hi):
    return max(lo, min(hi, value))


def _parse_timeout(raw, default=30.0):
    """Parse a query-string timeout into a clamped float.

    Returns ``default`` when ``raw`` is missing or non-numeric, then clamps to
    [MIN_WAIT_TIMEOUT_S, MAX_WAIT_TIMEOUT_S] so a bad value can't hang a worker.
    """
    try:
        value = float(raw)
    except (TypeError, ValueError):
        value = default
    return _clamp(value, MIN_WAIT_TIMEOUT_S, MAX_WAIT_TIMEOUT_S)


def _validate_waypoints(data):
    """Validate and normalise a waypoints list from request JSON.

    Returns (clean_waypoints, None) on success or (None, error_string) on failure.
    """
    wps = data.get("waypoints")
    if not isinstance(wps, list) or not wps:
        return None, "waypoints must be a non-empty array"
    if len(wps) > MAX_WAYPOINTS:
        return None, f"waypoints exceeds max allowed ({MAX_WAYPOINTS})"

    clean = []
    joint_keys = ["j1", "j2", "j3", "j4", "j5", "j6"]
    limit_keys = ["joint_1", "joint_2", "joint_3", "joint_4", "joint_5", "joint_6"]

    for i, wp in enumerate(wps):
        if not isinstance(wp, dict):
            return None, f"waypoint {i}: must be an object"
        cleaned = {}
        for jk, lk in zip(joint_keys, limit_keys):
            v = wp.get(jk)
            if v is None or isinstance(v, bool) or not isinstance(v, (int, float)):
                return None, f"waypoint {i}: {jk} must be a numeric value"
            lo, hi = JOINT_LIMITS_DEG[lk]
            cleaned[jk] = _clamp(float(v), lo, hi)

        hand = wp.get("hand", 0.0)
        if isinstance(hand, bool) or not isinstance(hand, (int, float)):
            return None, f"waypoint {i}: hand must be numeric"
        cleaned["hand"] = _clamp(float(hand), *JOINT_LIMITS_DEG["hand"])

        dt = wp.get("dt", 0.05)
        if isinstance(dt, bool) or not isinstance(dt, (int, float)):
            return None, f"waypoint {i}: dt must be numeric"
        cleaned["dt"] = _clamp(float(dt), 0.005, 10.0)

        clean.append(cleaned)

    return clean, None


@bp.route("/move-joints")
def moveCobotta():
    joint_delta = []
    missing = []
    for i in range(1, 7):
        v = request.args.get(f"joint_{i}", type=float)
        if v is None:
            missing.append(f"joint_{i}")
        joint_delta.append(v)

    hand = request.args.get("hand", type=float)
    if hand is None:
        missing.append("hand")
    joint_delta.append(hand)

    if missing:
        return jsonify({"error": "missing or non-numeric params", "params": missing}), 400

    # Clamp to joint limits before publishing.
    limit_keys = ["joint_1", "joint_2", "joint_3", "joint_4", "joint_5", "joint_6", "hand"]
    joint_delta = [
        _clamp(joint_delta[k], *JOINT_LIMITS_DEG[limit_keys[k]])
        for k in range(7)
    ]

    # Route the single absolute pose through the trajectory controllers, ~1 s.
    wp = {f"j{i}": joint_delta[i - 1] for i in range(1, 7)}
    wp["hand"] = joint_delta[6]
    wp["dt"] = 1.0
    if not flask_pub.execute_path([wp]):
        return jsonify({"error": "command rejected — no controller listening or stop in progress"}), 503
    flask_pub.get_logger().info('move-joints → %s' % joint_delta)
    return jsonify({"status": "ok"})


@bp.route("/move-path", methods=["POST"])
def movePath():
    data = request.get_json()
    if not data or "waypoints" not in data:
        return jsonify({"error": "missing waypoints array"}), 400

    clean, err = _validate_waypoints(data)
    if err:
        return jsonify({"error": err}), 400

    if not flask_pub.execute_path(clean):
        return jsonify({"error": "command rejected — no controller listening or stop in progress"}), 503
    return jsonify({"status": "path started"})


@bp.route("/stop", methods=["POST"])
def stopPath():
    was_active = flask_pub.stop_path()
    # None when no hardware node is running — sim-only stop is enough in that case.
    halt = flask_pub.call_halt()
    # "stopped" is a claim about the ARM, so it must not be made when the halt
    # channel reported failure. It used to be hardcoded, so a refused or timed
    # out halt reached Django as a 200 saying "stopped": the operator's panel
    # showed the run ended and the banner telling them the arm might still be
    # moving — the one message that matters here — could never fire.
    halt_failed = halt is not None and not halt.get("ok")
    return jsonify({
        "status": "halt-failed" if halt_failed else "stopped",
        "was_executing": was_active,
        "hardware_halt": halt,
    })


@bp.route("/health")
def health():
    return jsonify(flask_pub.get_health())


def createJointState(joint_positions):
    joint_state = JointState()
    joint_state.header.stamp = flask_pub.get_clock().now().to_msg()
    # Positions are absolute joint targets in degrees.
    joint_state.header.frame_id = ""
    joint_state.name = [f"joint_{i}" for i in range(1, 7)]
    joint_state.name.append("hand")
    joint_state.position = joint_positions
    joint_state.velocity = []
    joint_state.effort = []
    return joint_state


@bp.route("/create-trajectory")
def createTrajectory():
    name = request.args.get("name", type=str)
    db = get_db()

    if checkNameTrajectoryExists(db, name):
        return jsonify({"error": "name already exists"}), 400

    db.execute("INSERT INTO trajectories (name) values (?)", (name,))
    db.commit()
    trajectory = db.execute(
        "SELECT * FROM trajectories WHERE name=?", (name,)
    ).fetchone()
    return {"id": trajectory["id"], "name": trajectory["name"]}


def checkNameTrajectoryExists(db, name):
    trajectory = db.execute(
        "SELECT * FROM trajectories WHERE name=?", (name,)
    ).fetchone()
    return trajectory is not None


@bp.route("/trajectories")
def getTrajectories():
    db = get_db()
    trajectories = db.execute("SELECT * FROM trajectories").fetchall()
    return {
        "result": [
            {"id": trajectory["id"], "name": trajectory["name"]}
            for trajectory in trajectories
        ]
    }


@bp.route("/trajectory/<int:id>/save-point")
def savePoint(id):
    trajectory_id = id
    robot_position = sendRequestPosition()
    db = get_db()
    db.execute(
        "INSERT INTO points (j1,j2,j3,j4,j5,j6,hand,trajectory_id) values (?,?,?,?,?,?,?,?)",
        (
            robot_position.get('joint1', 0.0),
            robot_position.get('joint2', 0.0),
            robot_position.get('joint3', 0.0),
            robot_position.get('joint4', 0.0),
            robot_position.get('joint5', 0.0),
            robot_position.get('joint6', 0.0),
            robot_position.get('joint_left', 0.0),
            trajectory_id,
        ),
    )
    db.commit()
    return {"message": "point add successfully"}


@bp.route("/trajectory/<int:id>/points")
def getPointsByTrajectory(id):
    db = get_db()
    points = db.execute(
        "SELECT * FROM points JOIN trajectories ON points.trajectory_id = trajectories.id WHERE trajectories.id = ?",
        (id,),
    ).fetchall()
    return {
        "result": [
            {
                "id": point["id"],
                "j1": point["j1"],
                "j2": point["j2"],
                "j3": point["j3"],
                "j4": point["j4"],
                "j5": point["j5"],
                "j6": point["j6"],
                "hand": point["hand"],
            }
            for point in points
        ]
    }


@bp.route("/points/<int:id>", methods=["DELETE"])
def deletePoint(id):
    db = get_db()
    db.execute("DELETE FROM points WHERE points.id = ?", (id,))
    db.commit()
    return {"message": "point deleted successfully"}


@bp.route("/trajectories/<int:id>", methods=["DELETE"])
def deleteTrajectory(id):
    db = get_db()
    db.execute("DELETE FROM points WHERE trajectory_id = ?", (id,))
    db.execute("DELETE FROM trajectories WHERE trajectories.id = ?", (id,))
    db.commit()
    return {"message": "trajectories deleted successfully"}


@bp.route("/trajectory/<int:id>")
def showTrajectory(id):
    db = get_db()
    trajectory = db.execute("SELECT * FROM trajectories WHERE id=?", (id,)).fetchone()
    return {"id": trajectory["id"], "name": trajectory["name"]}


@bp.route("/trajectory/<int:id>/play")
def playTrajectory(id):
    # playTrajectory needs the ROS service /play_trajectory, only available
    # via cobotta_node (physical robot) — unsupported under BridgeNodeROS in
    # simulation mode.
    return jsonify({"error": "Trajectory playback not available in simulation mode"}), 501


def createListPosJoint(points, req):
    for point in points:
        joint_state = createJointState(getJointsPosFromPoint(point))
        req.joints_position.append(joint_state)


def getJointsPosFromPoint(point):
    joints_position = []
    for i in range(1, 7):
        joints_position.append(point[f"j{i}"])
    joints_position.append(point["hand"])
    return joints_position


@bp.route("/actual-joints-pos")
def getActualJointsPos():
    position_dict = sendRequestPosition()
    actual_joints_position = [
        position_dict.get('joint1', 0.0),
        position_dict.get('joint2', 0.0),
        position_dict.get('joint3', 0.0),
        position_dict.get('joint4', 0.0),
        position_dict.get('joint5', 0.0),
        position_dict.get('joint6', 0.0),
        position_dict.get('joint_left', 0.0),
    ]
    return {"position": actual_joints_position}


@bp.route("/actual-joints-real")
def getActualJointsReal():
    """Physical arm encoder state (j1..j6 deg) from cobotta_node, or available=False.

    Used by simulate.py to seed IK from the real robot when DRIVE_HARDWARE is set.
    """
    pos = flask_pub.send_request_position_real()
    if not pos:
        return {"position": [], "available": False}
    return {
        "position": [pos.get(f"joint{i}", 0.0) for i in range(1, 7)],
        "available": True,
    }


# ── Human step lifecycle ──────────────────────────────────────────────────────

@bp.route("/human-step-start", methods=["POST"])
def humanStepStart():
    data = request.get_json(silent=True) or {}
    # condition/value/timeout must be forwarded — the frontend keys the
    # gesture self-view, the Required/Detected match card, and the countdown
    # off them (simulate.py sends condition="gesture"/"voice"/"object",
    # value=THUMBS_UP/YES/objectName, timeout=seconds). Dropping them (the
    # previous behaviour) left every human step looking like a bare
    # "Waiting for operator..." with no camera and no countdown.
    flask_pub.publish_step_status({
        "status": "started",
        "description": data.get("description", ""),
        "condition": data.get("condition", ""),
        "value": data.get("value", ""),
        "timeout": data.get("timeout"),
        "timestamp": time.time(),
    })
    return jsonify({"status": "ok"})


@bp.route("/human-step-complete", methods=["POST"])
def humanStepComplete():
    flask_pub.publish_step_status({
        "status": "completed",
        "timestamp": time.time(),
    })
    return jsonify({"status": "ok"})


@bp.route("/human-step-timeout", methods=["POST"])
def humanStepTimeout():
    data = request.get_json(silent=True) or {}
    flask_pub.publish_step_status({
        "status": "timeout",
        "condition": data.get("condition", ""),
        "value": data.get("value", ""),
        "timestamp": time.time(),
    })
    return jsonify({"status": "ok"})


@bp.route("/notify", methods=["POST"])
def notifyAction():
    data = request.get_json(silent=True) or {}
    # "notify" (default) is a benign notify_action_block message; simulate.py's
    # _abort_task sends "error" so the frontend can render a task-stopped
    # banner distinctly (persistent, not the auto-dismissing informational
    # style) instead of both looking identical to the operator.
    flask_pub.publish_step_status({
        "status": data.get("status", "notify"),
        "description": data.get("description", ""),
        "timestamp": time.time(),
    })
    return jsonify({"status": "ok"})


@bp.route("/block-step", methods=["POST"])
def blockStep():
    # Live highlighting of the executing Blockly block. Reuses the step-status
    # topic; `kind: "block"` makes polling_socket route it to the block_step
    # socket channel instead of the human-step overlay.
    data = request.get_json(silent=True) or {}
    flask_pub.publish_step_status({
        "kind": "block",
        "blockId": data.get("blockId", ""),
        "blockType": data.get("blockType", ""),
        "phase": data.get("phase", ""),
        "timestamp": time.time(),
    })
    return jsonify({"status": "ok"})


# ── Vision wait endpoints ─────────────────────────────────────────────────────

@bp.route("/move-target", methods=["POST"])
def moveTarget():
    """Receive one absolute PTP target pose and call /cobotta/move_target service.

    Body: {"j1": float, ..., "j6": float, "hand": float, "hand_only": bool} (degrees).
    When hand_only=true only the gripper moves; joint values are ignored.
    Used by simulate.py when DRIVE_HARDWARE is set to drive the real arm alongside Gazebo.
    Blocks until the service call completes (natural backpressure).
    """
    data = request.get_json(silent=True) or {}
    hand_only = bool(data.get("hand_only", False))

    joint_keys = ["j1", "j2", "j3", "j4", "j5", "j6"]
    limit_keys = ["joint_1", "joint_2", "joint_3", "joint_4", "joint_5", "joint_6"]

    joints = []
    missing = []

    if not hand_only:
        for jk, lk in zip(joint_keys, limit_keys):
            v = data.get(jk)
            if v is None or isinstance(v, bool) or not isinstance(v, (int, float)):
                missing.append(jk)
                joints.append(0.0)
            else:
                lo, hi = JOINT_LIMITS_DEG[lk]
                joints.append(_clamp(float(v), lo, hi))

    hand_raw = data.get("hand", 0.0)
    if isinstance(hand_raw, bool) or not isinstance(hand_raw, (int, float)):
        missing.append("hand")
        hand = 0.0
    else:
        hand = _clamp(float(hand_raw), *JOINT_LIMITS_DEG["hand"])

    if missing and not hand_only:
        return jsonify({"error": "missing or non-numeric params", "params": missing}), 400

    result = flask_pub.call_move_target(joints, hand, hand_only)
    return jsonify(result)


@bp.route("/vision/report", methods=["POST"])
def visionReport():
    data = request.get_json(silent=True) or {}
    gesture = data.get("gesture", "NONE")
    flask_pub.report_vision(gesture)
    return jsonify({"status": "ok"})


@bp.route("/vision/state")
def visionState():
    return jsonify(flask_pub.get_vision_state())


@bp.route("/vision/wait-gesture")
def visionWaitGesture():
    gesture = request.args.get("gesture", "THUMBS_UP")
    timeout = _parse_timeout(request.args.get("timeout"))
    detected = flask_pub.wait_for_gesture(gesture, timeout)
    return jsonify({"detected": detected, "gesture": gesture})


@bp.route("/vision/wait-object")
def visionWaitObject():
    target_class = request.args.get("target_class", "")
    timeout = _parse_timeout(request.args.get("timeout"))
    if not target_class:
        return jsonify({"error": "target_class required"}), 400
    detected = flask_pub.wait_for_object(target_class, timeout)
    return jsonify({"detected": detected, "target_class": target_class})
