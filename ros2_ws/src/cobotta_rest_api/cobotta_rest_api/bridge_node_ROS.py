import json
import threading
import time

from rclpy.node import Node
from sensor_msgs.msg import JointState
from std_msgs.msg import String
from trajectory_msgs.msg import JointTrajectory, JointTrajectoryPoint
from builtin_interfaces.msg import Duration
from .cobotta_utils import (
    convert_rad_to_grad,
    convert_grad_to_rad,
    convert_hand_cobotta_gazebo,
)
from my_robot_interfaces.srv import MoveTarget


class BridgeNodeROS(Node):
    def __init__(self):
        super().__init__("bridge_node_ros")

        # arm_controller (JTC) takes the 6 arm joints in radians; gripper_controller
        # takes the two prismatic finger joints in metres.
        self.arm_traj_pub = self.create_publisher(
            JointTrajectory, "/arm_controller/joint_trajectory", 10)
        self.gripper_traj_pub = self.create_publisher(
            JointTrajectory, "/gripper_controller/joint_trajectory", 10)
        self.step_status_pub = self.create_publisher(String, "/human/step_status", 10)
        self._gesture_pub = self.create_publisher(String, "/human/gesture", 10)
        self._move_target_client = self.create_client(MoveTarget, "/cobotta/move_target")

        self.subscriber = self.create_subscription(
            JointState, "/joint_states", self.position_callback, 10
        )
        # Real arm encoder feed (cobotta_node when DRIVE_HARDWARE) — lets the app seed
        # IK from the physical robot instead of the Gazebo twin.
        self.create_subscription(
            JointState, "/cobotta/joint_states_real", self._real_position_callback, 10)
        self.create_subscription(String, "/human/gesture", self._gesture_callback, 10)
        self.create_subscription(String, "/vision/object_detected", self._object_callback, 10)

        # Latest-value cache for vision topics (Fix 1: no rclpy.wait_for_message).
        # The Events let wait_for_* block on a condition variable instead of
        # busy-polling the Flask request thread; callbacks set them on each update.
        self._gesture_lock = threading.Lock()
        self._latest_gesture = "NONE"
        self._latest_gesture_time = 0.0
        self._gesture_event = threading.Event()

        self._object_lock = threading.Lock()
        self._latest_detections: list = []
        self._latest_object_time = 0.0
        self._object_event = threading.Event()

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

        # Real arm joint state (empty until cobotta_node publishes encoder readings).
        self.current_position_real: dict = {}

        # Guards both position dicts (written by ROS spin thread, read by Flask threads).
        self._position_lock = threading.Lock()

        self.get_logger().info(
            "BridgeNodeROS initialized — /joint_states in, arm/gripper trajectory out")

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
            # Rotational joints come in radians; convert to degrees for consistency with
            # the rest of the stack (Flask API, simulate.py).
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

    def _real_position_callback(self, msg):
        """Cache the physical arm's encoder state (rad → deg), same as the sim path."""
        pos = {name: convert_rad_to_grad(p) for name, p in zip(msg.name, msg.position)}
        with self._position_lock:
            self.current_position_real.update(pos)

    def send_request_position_real(self):
        """Real arm joint state, or {} if cobotta_node has published nothing yet."""
        with self._position_lock:
            return dict(self.current_position_real)

    # ── command path (ros2_control trajectory controllers) ────────────────────

    @staticmethod
    def _duration(t):
        sec = int(t)
        return Duration(sec=sec, nanosec=int(round((t - sec) * 1e9)))

    def execute_path(self, waypoints):
        """Send waypoints {j1..j6 (deg), hand (0-30), dt (s)} as one JointTrajectory.

        Publishing replaces the previous trajectory; safe because the app sleeps for
        each move's duration before sending the next (smooth_move / send_waypoints).
        """
        if not waypoints:
            return
        arm = JointTrajectory()
        arm.joint_names = [f"joint{i}" for i in range(1, 7)]
        grip = JointTrajectory()
        grip.joint_names = ["joint_left", "joint_right"]

        t = 0.0
        for wp in waypoints:
            t += float(wp.get("dt", 0.05))
            stamp = self._duration(t)

            ap = JointTrajectoryPoint()
            ap.positions = [convert_grad_to_rad(float(wp.get(f"j{i}", 0.0)))
                            for i in range(1, 7)]
            ap.time_from_start = stamp
            arm.points.append(ap)

            gpos = convert_hand_cobotta_gazebo(float(wp.get("hand", 0.0)))
            gp = JointTrajectoryPoint()
            gp.positions = [gpos, gpos]   # both fingers symmetric
            gp.time_from_start = stamp
            grip.points.append(gp)

        # header.stamp left 0 → controllers start now; time_from_start is relative.
        self.arm_traj_pub.publish(arm)
        self.gripper_traj_pub.publish(grip)
        self.get_logger().debug(f"Sent trajectory: {len(arm.points)} pts over {t:.2f}s")

    def stop_path(self):
        """Cancel motion by sending an empty trajectory to each controller."""
        self.arm_traj_pub.publish(
            JointTrajectory(joint_names=[f"joint{i}" for i in range(1, 7)]))
        self.gripper_traj_pub.publish(
            JointTrajectory(joint_names=["joint_left", "joint_right"]))
        self.get_logger().info("Stop requested — empty trajectory sent")
        return True

    # ── vision topic callbacks (latest-value cache) ──────────────────────────

    def _gesture_callback(self, msg: String):
        with self._gesture_lock:
            self._latest_gesture = msg.data
            self._latest_gesture_time = time.monotonic()
        self._gesture_event.set()  # wake any waiter

    def _object_callback(self, msg: String):
        try:
            data = json.loads(msg.data)
            detections = data.get("detections", [])
        except (json.JSONDecodeError, AttributeError):
            detections = []
        with self._object_lock:
            self._latest_detections = detections
            self._latest_object_time = time.monotonic()
        self._object_event.set()  # wake any waiter

    # ── human step status publisher ──────────────────────────────────────────

    def publish_step_status(self, payload: dict):
        msg = String()
        msg.data = json.dumps(payload)
        self.step_status_pub.publish(msg)

    # ── vision wait helpers (polling, no rclpy.wait_for_message) ────────────

    def wait_for_gesture(self, target_gesture: str, timeout: float) -> bool:
        # clear-then-check ordering avoids a lost wakeup: any set() racing our
        # check is still pending when we wait(), so wait() returns immediately.
        deadline = time.monotonic() + timeout
        remaining = timeout
        while remaining > 0:
            self._gesture_event.clear()
            with self._gesture_lock:
                if self._latest_gesture == target_gesture:
                    return True
            self._gesture_event.wait(remaining)
            remaining = deadline - time.monotonic()
        return False

    def wait_for_object(self, target_class: str, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        remaining = timeout
        while remaining > 0:
            self._object_event.clear()
            with self._object_lock:
                if any(d.get("class") == target_class for d in self._latest_detections):
                    return True
            self._object_event.wait(remaining)
            remaining = deadline - time.monotonic()
        return False

    # ── browser-vision report (called by Django vision_live.py) ─────────────

    def report_vision(self, gesture: str):
        with self._gesture_lock:
            self._latest_gesture = gesture
            self._latest_gesture_time = time.monotonic()
        self._gesture_event.set()  # wake any waiter

        g_msg = String()
        g_msg.data = gesture
        self._gesture_pub.publish(g_msg)

    def call_move_target(self, joints, hand, hand_only=False, timeout=60.0) -> dict:
        """Call /cobotta/move_target service. Returns immediately if no service available."""
        if not self._move_target_client.wait_for_service(timeout_sec=0.2):
            return {"ok": False, "message": "no hardware"}
        req = MoveTarget.Request()
        req.joints = [float(j) for j in joints]
        req.hand = float(hand)
        req.hand_only = bool(hand_only)
        future = self._move_target_client.call_async(req)
        deadline = time.monotonic() + timeout
        while not future.done():
            if time.monotonic() > deadline:
                return {"ok": False, "message": "timeout"}
            time.sleep(0.02)
        result = future.result()
        return {"ok": result.ok, "message": result.message}

    def get_vision_state(self) -> dict:
        with self._gesture_lock:
            gesture = self._latest_gesture
            gesture_age = time.monotonic() - self._latest_gesture_time
        with self._object_lock:
            detections = list(self._latest_detections)
        return {"gesture": gesture, "detections": detections, "gesture_age_s": round(gesture_age, 2)}
