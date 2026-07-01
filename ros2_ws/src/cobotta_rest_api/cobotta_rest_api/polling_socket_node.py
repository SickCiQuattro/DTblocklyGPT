import json
import os
import signal
from threading import Thread

import rclpy
from rclpy.node import Node
from std_msgs.msg import String

from flask import Flask
from flask_socketio import SocketIO
from flask_cors import CORS


class PollingSocketNode(Node):

    def __init__(self):
        super().__init__("polling_socket_node")

        self.gesture_sub = self.create_subscription(
            String, "/human/gesture", self.gesture_callback, 10
        )
        self.object_sub = self.create_subscription(
            String, "/vision/object_detected", self.object_callback, 10
        )
        self.step_status_sub = self.create_subscription(
            String, "/human/step_status", self.step_status_callback, 10
        )

    def gesture_callback(self, msg):
        socketio.emit('gesture_detected', msg.data)

    def object_callback(self, msg):
        try:
            data = json.loads(msg.data)
        except json.JSONDecodeError:
            data = msg.data
        socketio.emit('object_detected', data)

    def step_status_callback(self, msg):
        try:
            data = json.loads(msg.data)
        except json.JSONDecodeError:
            data = msg.data
        # Route block-execution events to their own channel so the human-step
        # overlay (which keys off `status`) is not triggered by block highlights.
        if isinstance(data, dict) and data.get("kind") == "block":
            socketio.emit('block_step', data)
        else:
            socketio.emit('human_step', data)


app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*")


def main(args=None):
    rclpy.init(args=args)
    polling_node = PollingSocketNode()

    spin_thread = Thread(target=rclpy.spin, args=(polling_node,), daemon=True)
    spin_thread.start()

    # lab/sim tool — werkzeug dev server is intentional here
    def _sigterm_handler(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, _sigterm_handler)

    host = os.getenv("POLLING_NODE_HOST", "localhost")
    port = int(os.getenv("POLLING_NODE_PORT", "5001"))

    try:
        socketio.run(app, debug=False, host=host, port=port, allow_unsafe_werkzeug=True)
    finally:
        rclpy.shutdown()
        spin_thread.join(timeout=2.0)
        try:
            polling_node.destroy_node()
        except Exception:
            pass


if __name__ == '__main__':
    main()
