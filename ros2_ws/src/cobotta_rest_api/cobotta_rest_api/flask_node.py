import os
import signal
from threading import Thread

import rclpy

from flask import Flask
from flask_cors import CORS

from .bridge_node_ROS import BridgeNodeROS

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# Must init rclpy before creating the node
rclpy.init()
flask_pub = BridgeNodeROS()


def sendRequestPosition():
    return flask_pub.send_request_position()


from . import db
db.init_app(app)

from .blueprints import flask_api
app.register_blueprint(flask_api.bp)


def main(args=None):
    spin_thread = Thread(target=rclpy.spin, args=(flask_pub,), daemon=True)
    spin_thread.start()

    # launch_sim.sh kills nodes with SIGTERM; convert it to KeyboardInterrupt so werkzeug exits cleanly.
    def _sigterm_handler(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, _sigterm_handler)

    host = os.getenv("FLASK_NODE_HOST", "localhost")
    port = int(os.getenv("FLASK_NODE_PORT", "5000"))

    try:
        app.run(debug=False, host=host, port=port)
    finally:
        rclpy.shutdown()          # unblocks rclpy.spin in spin_thread
        spin_thread.join(timeout=2.0)
        try:
            flask_pub.destroy_node()
        except Exception:
            pass


if __name__ == "__main__":
    main()
