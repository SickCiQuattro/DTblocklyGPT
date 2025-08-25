from threading import Thread

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import JointState
from my_robot_interfaces.srv import PositionJoint
from my_robot_interfaces.srv import ListPosJoint

from flask import Flask
from flask_cors import CORS


class FlaskNode(Node):
    def __init__(self):
        rclpy.init()
        super().__init__("flask_node")
        self.publisher = self.create_publisher(JointState, '/move_joint', 10)
        self.client = self.create_client(PositionJoint, '/get_position_joints')
        self.client_play_trajectory = self.create_client(ListPosJoint, '/play_trajectory')



app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

flask_pub = FlaskNode()

def sendRequestPosition():
    req = PositionJoint.Request()
    future = flask_pub.client.call(req)
    return future.position




from . import db
db.init_app(app)

from .blueprints import flask_api
app.register_blueprint(flask_api.bp)


def main(args=None):
    Thread(target=lambda: rclpy.spin(flask_pub)).start()
    app.run(debug=True, host="localhost")
    flask_pub.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()
