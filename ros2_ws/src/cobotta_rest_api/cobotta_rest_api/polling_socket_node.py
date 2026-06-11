import os
import signal
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

    def actual_position_callback(self, msg):
        actual_position = list(msg.position)
        socketio.emit('robot_position', actual_position)


polling_node = FlaskNode()

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*")


def main(args=None):
    spin_thread = Thread(target=rclpy.spin, args=(polling_node,), daemon=True)
    spin_thread.start()

    # lab/sim tool — werkzeug dev server is intentional here
    def _sigterm_handler(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, _sigterm_handler)

    host = os.getenv("POLLING_NODE_HOST", "localhost")
    port = int(os.getenv("POLLING_NODE_PORT", "5001"))

    try:
        socketio.run(app, debug=True, host=host, port=port, allow_unsafe_werkzeug=True)
    finally:
        rclpy.shutdown()
        spin_thread.join(timeout=2.0)
        try:
            polling_node.destroy_node()
        except Exception:
            pass


if __name__ == '__main__':
    main()
