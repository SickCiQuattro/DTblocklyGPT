from sensor_msgs.msg import JointState
from flask import Blueprint, request, jsonify

from ..db import get_db
from ..flask_node import flask_pub
from ..flask_node import sendRequestPosition
from my_robot_interfaces.srv import ListPosJoint


bp = Blueprint('api', __name__, url_prefix='/api')

@bp.route("/move-joints")
def moveCobotta():
    joint_delta = get_joints_delta_from_request()
    joint_state = createJointState(joint_delta,  request.args.get('joint_abs', type=str))
    flask_pub.publisher.publish(joint_state)
    flask_pub.get_logger().info('Publishing: "%s"' % joint_state.position)
    actual_joints_position = list(sendRequestPosition())
    return { 'position' : actual_joints_position }

def get_joints_delta_from_request() :
    joint_delta = []
    for i in range(1, 7):
        joint_delta.append(request.args.get(f'joint_{i}', type=float))
    joint_delta.append(request.args.get('hand', type=float))
    return joint_delta

def createJointState(joint_delta, joint_abs):
    joint_state = JointState()
    joint_state.header.stamp = flask_pub.get_clock().now().to_msg()
    joint_state.header.frame_id = joint_abs
    joint_state.name = [f'joint_{i}' for i in range(1, 7)]
    joint_state.name.append('hand')
    joint_state.position = joint_delta
    joint_state.velocity = []
    joint_state.effort = []
    return joint_state



@bp.route("/create-trajectory")
def createTrajectory():
    name = request.args.get('name', type=str)
    db = get_db()

    if checkNameTrajectoryExists(db, name):
        return jsonify({'error' : 'name already exists'}),400

    db.execute("INSERT INTO trajectories (name) values (?)", (name,))
    db.commit()
    trajectory = db.execute("SELECT * FROM trajectories WHERE name=?", (name,)).fetchone()
    return {'id': trajectory['id'],
            'name': trajectory['name']}


def checkNameTrajectoryExists(db, name):
    trajectory = db.execute("SELECT * FROM trajectories WHERE name=?", (name,)).fetchone()
    return trajectory is not None


@bp.route("/trajectories")
def getTrajectories():
    db = get_db()
    trajectories = db.execute("SELECT * FROM trajectories").fetchall()
    return {'result':[{'id': trajectory['id'],
            'name': trajectory['name']} for trajectory in trajectories]}

@bp.route("/trajectory/<int:id>/save-point")
def savePoint(id):
    trajectory_id = id
    robot_position = sendRequestPosition()
    db = get_db()
    db.execute("INSERT INTO points (j1,j2,j3,j4,j5,j6,hand,trajectory_id) values (?,?,?,?,?,?,?,?)",
               (robot_position[0], robot_position[1], robot_position[2], robot_position[3],
                robot_position[4], robot_position[5], robot_position[6], trajectory_id))
    db.commit()
    return { 'message' : 'point add successfully' }

@bp.route("/trajectory/<int:id>/points")
def getPointsByTrajectory(id):
    db = get_db()
    points = db.execute("SELECT * FROM points JOIN trajectories ON points.trajectory_id = trajectories.id WHERE trajectories.id = ?",
                        (id,)).fetchall()
    return {'result': [{'id': point['id'],
                        'j1': point['j1'],
                        'j2': point['j2'],
                        'j3': point['j3'],
                        'j4': point['j4'],
                        'j5': point['j5'],
                        'j6': point['j6'],
                        'hand': point['hand']} for point in points]}



@bp.route("/points/<int:id>", methods=["DELETE"])
def deletePoint(id):
    db = get_db()
    db.execute("DELETE FROM points WHERE points.id = ?", (id,))
    db.commit()
    return {'message' : "point deleted successfully"}

@bp.route("/trajectories/<int:id>", methods=["DELETE"])
def deleteTrajectory(id):
    db = get_db()
    db.execute("DELETE FROM points WHERE trajectory_id = ?", (id,))
    db.execute("DELETE FROM trajectories WHERE trajectories.id = ?", (id,))
    db.commit()
    return {'message' : "trajectories deleted successfully"}

@bp.route("/trajectory/<int:id>")
def showTrajectory(id):
    db = get_db()
    trajectory = db.execute("SELECT * FROM trajectories WHERE id=?", (id,)).fetchone()
    return {'id': trajectory['id'],
            'name': trajectory['name']}



@bp.route("/trajectory/<int:id>/play")
def playTrajectory(id):
    db = get_db()
    points = db.execute("SELECT * FROM points JOIN trajectories ON points.trajectory_id = trajectories.id WHERE trajectories.id = ?",(id,)).fetchall()
    req = ListPosJoint.Request()  #request client (service ros)
    createListPosJoint(points, req)
    future = flask_pub.client_play_trajectory.call(req)
    return {'completed' : future.completed}

def createListPosJoint(points, req):
    for point in points:
        joint_state = createJointState(getJointsPosFromPoint(point), "true")
        req.joints_position.append(joint_state)

def getJointsPosFromPoint(point):
    joints_position = []
    for i in range(1,7):
        joints_position.append(point[f'j{i}'])
    joints_position.append(point['hand'])
    return joints_position


@bp.route("/actual-joints-pos")
def getActualJointsPos():
    actual_joints_position = list(sendRequestPosition())
    return {'position': actual_joints_position}


