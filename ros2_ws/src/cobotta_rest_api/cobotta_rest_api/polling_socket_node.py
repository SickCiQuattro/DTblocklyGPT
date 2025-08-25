from threading import Thread

import rclpy
from rclpy.node import Node
from my_robot_interfaces.msg import PosJoint

from flask import Flask
from flask_socketio import SocketIO
from flask_cors import CORS


class FlaskNode(Node):

    def __init__(self):
        rclpy.init()
        super().__init__("polling_socket_node")
        self.subscriber = self.create_subscription(
            PosJoint, "/actual_joint_position", self.actual_position_callback, 10
        )

    def actual_position_callback(self, msg): #emit msg on web socket (event: robot_position)
        actual_position = list(msg.position)
        socketio.emit('robot_position', actual_position)


polling_node = FlaskNode()

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*")



def main(args=None):
    Thread(target=lambda: rclpy.spin(polling_node)).start()
    socketio.run(app, debug=True, host="localhost", port=5001)
    polling_node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()
