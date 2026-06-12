from sensor_msgs.msg import JointState
from flask import Blueprint, request, jsonify

from ..db import get_db
from ..flask_node import flask_pub
from ..flask_node import sendRequestPosition

import time


bp = Blueprint("api", __name__, url_prefix="/api")

# Joint limits in degrees — from cobotta_description/urdf/cobotta.urdf (converted rad→deg).
JOINT_LIMITS_DEG = {
    "joint_1": (-150.0, 150.0),
    "joint_2": (-60.0, 100.0),
    "joint_3": (18.0, 140.0),
    "joint_4": (-170.0, 170.0),
    "joint_5": (-95.0, 135.0),
    "joint_6": (-170.0, 170.0),
    "hand":    (0.0, 30.0),
}
MAX_WAYPOINTS = 5000


def _clamp(value, lo, hi):
    return max(lo, min(hi, value))


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

    # joint_abs query param accepted for backwards compatibility but ignored —
    # all positions are absolute; the legacy abs/delta frame_id flag is retired.
    joint_state = createJointState(joint_delta)
    flask_pub.publisher.publish(joint_state)
    flask_pub.get_logger().info('Publishing: "%s"' % joint_state.position)
    return jsonify({"status": "ok"})


@bp.route("/move-path", methods=["POST"])
def movePath():
    data = request.get_json()
    if not data or "waypoints" not in data:
        return jsonify({"error": "missing waypoints array"}), 400

    clean, err = _validate_waypoints(data)
    if err:
        return jsonify({"error": err}), 400

    flask_pub.execute_path(clean)
    return jsonify({"status": "path started"})


@bp.route("/stop", methods=["POST"])
def stopPath():
    was_active = flask_pub.stop_path()
    return jsonify({"status": "stopped", "was_executing": was_active})


def createJointState(joint_positions):
    joint_state = JointState()
    joint_state.header.stamp = flask_pub.get_clock().now().to_msg()
    # Positions are absolute joint targets in degrees.
    # The legacy abs/delta flag (frame_id="true"/"false") is retired — gazebo_command_node ignores it.
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
    # TODO: playTrajectory richiede il service ROS /play_trajectory disponibile solo con cobotta_node (robot fisico).
    # Con BridgeNodeROS in modalità simulazione, questo endpoint non è supportato.
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


# ── Human step lifecycle ──────────────────────────────────────────────────────

@bp.route("/human-step-start", methods=["POST"])
def humanStepStart():
    data = request.get_json(silent=True) or {}
    flask_pub.publish_step_status({
        "status": "started",
        "description": data.get("description", ""),
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


# ── Vision wait endpoints ─────────────────────────────────────────────────────

@bp.route("/vision/wait-gesture")
def visionWaitGesture():
    gesture = request.args.get("gesture", "THUMBS_UP")
    timeout = float(request.args.get("timeout", 30))
    detected = flask_pub.wait_for_gesture(gesture, timeout)
    return jsonify({"detected": detected, "gesture": gesture})


@bp.route("/vision/wait-object")
def visionWaitObject():
    target_class = request.args.get("target_class", "")
    timeout = float(request.args.get("timeout", 30))
    if not target_class:
        return jsonify({"error": "target_class required"}), 400
    detected = flask_pub.wait_for_object(target_class, timeout)
    return jsonify({"detected": detected, "target_class": target_class})
