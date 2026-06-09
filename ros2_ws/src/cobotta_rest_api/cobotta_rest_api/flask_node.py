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
    # Ora restituisce il dizionario letto direttamente dal topic /joint_states
    return flask_pub.send_request_position()

from . import db
db.init_app(app)

from .blueprints import flask_api
app.register_blueprint(flask_api.bp)

def main(args=None):
    Thread(target=lambda: rclpy.spin(flask_pub)).start()
    app.run(debug=False, host="localhost")
    flask_pub.destroy_node()
    rclpy.shutdown()

if __name__ == "__main__":
    main()
