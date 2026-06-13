import json
import threading
import time

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import JointState
from std_msgs.msg import String
from .cobotta_utils import convert_rad_to_grad


class BridgeNodeROS(Node):
    def __init__(self):
        super().__init__("bridge_node_ros")

        self.publisher = self.create_publisher(JointState, "/move_joint", 10)
        self.step_status_pub = self.create_publisher(String, "/human/step_status", 10)
        self._gesture_pub = self.create_publisher(String, "/human/gesture", 10)
        self._object_pub = self.create_publisher(String, "/vision/object_detected", 10)

        self.subscriber = self.create_subscription(
            JointState, "/joint_states", self.position_callback, 10
        )
        self.create_subscription(String, "/human/gesture", self._gesture_callback, 10)
        self.create_subscription(String, "/vision/object_detected", self._object_callback, 10)

        # Latest-value cache for vision topics (Fix 1: no rclpy.wait_for_message)
        self._gesture_lock = threading.Lock()
        self._latest_gesture = "NONE"
        self._latest_gesture_time = 0.0

        self._object_lock = threading.Lock()
        self._latest_detections: list = []
        self._latest_object_time = 0.0

        self.current_position = {
            'joint1': 0.0,
            'joint2': 0.0,
            'joint3': 0.0,
            'joint4': 0.0,
            'joint5': 0.0,
            'joint6': 0.0,
            'joint_left': 0.0,
            'joint_right': 0.0,
        }

        # Guards current_position dict (written by ROS spin thread, read by Flask threads).
        self._position_lock = threading.Lock()

        # Guards path execution state (written by Flask threads, ticked by ROS spin thread).
        self._path_lock = threading.Lock()
        self.current_path = []
        self.path_index = 0
        self.executing = False
        self._next_due = 0.0  # monotonic deadline for next waypoint publish

        # Single persistent tick timer — runs only in the ROS spin thread, no cross-thread timer creation.
        self._tick_timer = self.create_timer(0.02, self._path_tick)

        self.get_logger().info("BridgeNodeROS initialized - listening to /joint_states")

    # ── position tracking ────────────────────────────────────────────────────

    def position_callback(self, msg):
        if len(msg.name) != len(msg.position):
            self.get_logger().warning(
                f'Mismatch: {len(msg.name)} names vs {len(msg.position)} positions'
            )
            return

        pos_dict = {}
        for name, pos in zip(msg.name, msg.position):
            # joint_left / joint_right are gripper linear joints — keep raw Gazebo value.
            # Rotational joints come in radians from Gazebo; convert to degrees for consistency
            # with the rest of the stack (Flask API, simulate.py, gazebo_command_node).
            if name.startswith('joint_'):
                pos_dict[name] = pos
            else:
                pos_dict[name] = convert_rad_to_grad(pos)

        with self._position_lock:
            self.current_position.update(pos_dict)

        self.get_logger().debug(f'Position updated: {self.current_position}')

    def send_request_position(self):
        with self._position_lock:
            return dict(self.current_position)

    # ── publishing ───────────────────────────────────────────────────────────

    def publish_joint_state(self, joint_state):
        self.publisher.publish(joint_state)
        self.get_logger().debug('Publishing: "%s"' % joint_state.position)

    # ── path execution ───────────────────────────────────────────────────────

    def execute_path(self, waypoints):
        """Queue waypoints for execution.

        Django sends sequential path segments and relies on append-if-executing
        semantics so consecutive smooth_move / send_waypoints calls chain up.
        """
        with self._path_lock:
            if self.executing:
                self.current_path.extend(waypoints)
            else:
                self.current_path = list(waypoints)
                self.path_index = 0
                self.executing = True
                self._next_due = time.monotonic()

    def stop_path(self):
        """Cancel any in-flight or queued path. Thread-safe. Returns True if path was active."""
        with self._path_lock:
            was_active = self.executing or self.path_index < len(self.current_path)
            self.current_path = []
            self.path_index = 0
            self.executing = False
        if was_active:
            self.get_logger().info("Path stopped by request")
        return was_active

    def _path_tick(self):
        """Persistent 20 ms timer — runs exclusively in the ROS spin thread."""
        with self._path_lock:
            if not self.executing:
                return
            if time.monotonic() < self._next_due:
                return
            if self.path_index >= len(self.current_path):
                self.executing = False
                self.get_logger().info("Path execution complete")
                return
            wp = self.current_path[self.path_index]
            self.path_index += 1
            dt = float(wp.get("dt", 0.05))
            self._next_due = time.monotonic() + dt

        # Build and publish outside the lock so position_callback is never blocked by publish latency.
        joint_state = JointState()
        joint_state.header.stamp = self.get_clock().now().to_msg()
        # Positions are absolute joint targets in degrees.
        # The legacy abs/delta flag (frame_id="true"/"false") is retired — gazebo_command_node ignores it.
        joint_state.header.frame_id = ""
        joint_state.name = [f"joint_{i}" for i in range(1, 7)] + ["hand"]
        joint_state.position = [
            float(wp.get("j1", 0.0)),
            float(wp.get("j2", 0.0)),
            float(wp.get("j3", 0.0)),
            float(wp.get("j4", 0.0)),
            float(wp.get("j5", 0.0)),
            float(wp.get("j6", 0.0)),
            float(wp.get("hand", 0.0)),
        ]
        self.publish_joint_state(joint_state)

    # ── vision topic callbacks (latest-value cache) ──────────────────────────

    def _gesture_callback(self, msg: String):
        with self._gesture_lock:
            self._latest_gesture = msg.data
            self._latest_gesture_time = time.monotonic()

    def _object_callback(self, msg: String):
        try:
            data = json.loads(msg.data)
            detections = data.get("detections", [])
        except (json.JSONDecodeError, AttributeError):
            detections = []
        with self._object_lock:
            self._latest_detections = detections
            self._latest_object_time = time.monotonic()

    # ── human step status publisher ──────────────────────────────────────────

    def publish_step_status(self, payload: dict):
        msg = String()
        msg.data = json.dumps(payload)
        self.step_status_pub.publish(msg)

    # ── vision wait helpers (polling, no rclpy.wait_for_message) ────────────

    def wait_for_gesture(self, target_gesture: str, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with self._gesture_lock:
                if self._latest_gesture == target_gesture:
                    return True
            time.sleep(0.1)
        return False

    def wait_for_object(self, target_class: str, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with self._object_lock:
                if any(d.get("class") == target_class for d in self._latest_detections):
                    return True
            time.sleep(0.1)
        return False

    # ── browser-vision report (called by Django vision_live.py) ─────────────

    def report_vision(self, gesture: str, detections: list):
        with self._gesture_lock:
            self._latest_gesture = gesture
            self._latest_gesture_time = time.monotonic()

        with self._object_lock:
            self._latest_detections = detections
            self._latest_object_time = time.monotonic()

        g_msg = String()
        g_msg.data = gesture
        self._gesture_pub.publish(g_msg)

        d_msg = String()
        d_msg.data = json.dumps({"detections": detections})
        self._object_pub.publish(d_msg)

    def get_vision_state(self) -> dict:
        with self._gesture_lock:
            gesture = self._latest_gesture
            gesture_age = time.monotonic() - self._latest_gesture_time
        with self._object_lock:
            detections = list(self._latest_detections)
        return {"gesture": gesture, "detections": detections, "gesture_age_s": round(gesture_age, 2)}
