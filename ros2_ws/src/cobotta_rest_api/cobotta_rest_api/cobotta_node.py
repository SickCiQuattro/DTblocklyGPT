import signal
import threading

import rclpy
from rclpy.node import Node
from rclpy.callback_groups import MutuallyExclusiveCallbackGroup, ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from sensor_msgs.msg import JointState

from .orin.bcapclient import BCAPClient as bcapclient
from .cobotta_utils import convert_grad_to_rad

from my_robot_interfaces.srv import MoveTarget


class HardwareControl(Node):
    """Physical-robot node (Denso Cobotta via B-CAP/RC8).

    Opt-in: set enable_hardware:=true to connect real hardware.
    Serves /cobotta/move_target service (absolute joint degrees), sends one PTP
    robot_move per request. Gazebo is driven separately by ros2_control.

    Launch with hardware:
        ros2 run cobotta_rest_api cobotta_node \\
            --ros-args -p enable_hardware:=true -p bcap_host:=192.168.0.1
    """

    def __init__(self):
        super().__init__("cobotta_node")

        # B-CAP connection params — configurable via ROS parameters.
        self.declare_parameter("bcap_host", "192.168.0.1")
        self.declare_parameter("bcap_port", 5007)
        self.declare_parameter("bcap_connect_timeout", 5.0)
        self.declare_parameter("bcap_timeout", 120)
        self.declare_parameter("enable_hardware", False)
        self.declare_parameter("ext_speed", 20)
        # ORiN/CAO provider. Use "CaoProv.DENSO.VRC" for the real COBOTTA over b-CAP
        # TCP too — verified on hardware: the RC8's b-CAP server accepts VRC, while
        # "CaoProv.DENSO.RC8" fails controller_connect with 0x80070057 (E_INVALIDARG).
        self.declare_parameter("bcap_provider", "CaoProv.DENSO.VRC")
        # COBOTTA servo-on preparation (ManualResetPreparation + MotionPreparation)
        # before Motor-on. Required on the physical COBOTTA; harmless to leave on.
        self.declare_parameter("cobotta_prep", True)

        self.host = self.get_parameter("bcap_host").value
        self.port = self.get_parameter("bcap_port").value
        self._connect_timeout = self.get_parameter("bcap_connect_timeout").value
        self._op_timeout = self.get_parameter("bcap_timeout").value
        self._provider = self.get_parameter("bcap_provider").value
        self._cobotta_prep = self.get_parameter("cobotta_prep").value
        enable_hardware = self.get_parameter("enable_hardware").value
        self._ext_speed = int(self.get_parameter("ext_speed").value)

        # B-CAP handles — set only when _hw_ok is True.
        self.m_bcapclient = None
        self.hCtrl = None
        self.HRobot = None
        self._hw_ok = False

        # Serializes every B-CAP socket op (the client holds one non-thread-safe
        # connection): the move service, reconnects, and the encoder-read timer.
        self._bcap_lock = threading.Lock()

        if enable_hardware:
            self._connect()
        else:
            self.get_logger().info(
                "cobotta_node: enable_hardware=false — hardware disabled, no B-CAP connection."
            )

        # Serve the synchronous move-target channel (absolute joint degrees).
        # Mutually-exclusive group + MultiThreadedExecutor: a blocking move (or a
        # hung B-CAP reconnect inside the callback) cannot starve other callbacks,
        # while still serializing requests (the B-CAP client is not thread-safe).
        self._cb_group = MutuallyExclusiveCallbackGroup()
        self.create_service(
            MoveTarget,
            "/cobotta/move_target",
            self._move_target_cb,
            callback_group=self._cb_group,
        )

        # Closed loop: publish the real arm's encoder state so the app can seed IK
        # from the physical robot (not the Gazebo twin). Separate topic so it does
        # not collide with the sim's joint_state_broadcaster on /joint_states.
        self._real_pub = self.create_publisher(JointState, "/cobotta/joint_states_real", 10)
        if enable_hardware and self._hw_ok:
            self.create_timer(0.1, self._publish_real_joint_state,
                              callback_group=ReentrantCallbackGroup())

        self.get_logger().info("cobotta_node ready — serving /cobotta/move_target")

    # ── B-CAP lifecycle ───────────────────────────────────────────────────────

    def _connect(self):
        with self._bcap_lock:
            self._connect_locked()

    def _connect_locked(self):
        """Raw connect sequence. Caller MUST hold self._bcap_lock."""
        try:
            self.get_logger().info(
                f"cobotta_node: connecting B-CAP to {self.host}:{self.port} provider={self._provider} (connect_timeout={self._connect_timeout}s, op_timeout={self._op_timeout}s) ..."
            )
            self.m_bcapclient = bcapclient(self.host, self.port, self._connect_timeout)
            self.get_logger().info("cobotta_node:  [1/8] service_start ...")
            self.m_bcapclient.service_start("")
            self.m_bcapclient.settimeout(self._op_timeout)
            self.get_logger().info("cobotta_node:  [2/8] controller_connect ...")
            self.hCtrl = self.m_bcapclient.controller_connect(
                "", self._provider, "localhost", ""
            )
            self.get_logger().info("cobotta_node:  [3/8] controller_getrobot ...")
            self.HRobot = self.m_bcapclient.controller_getrobot(self.hCtrl, "Arm0")
            # Pre-clear any latched error (yellow LED) so TakeArm is allowed
            # (otherwise 0x81501025 "command not available while an error occurs").
            # ManualResetPreparation must precede ClearError (0x83500372).
            if self._cobotta_prep:
                self.get_logger().info(
                    "cobotta_node:  [4/8] ManualResetPreparation + ClearError ...")
                try:
                    self.m_bcapclient.controller_execute(self.hCtrl, "ManualResetPreparation")
                    self.m_bcapclient.controller_execute(self.hCtrl, "ClearError")
                except Exception as exc:
                    self.get_logger().warning(
                        f"cobotta_node: pre-clear failed (continuing): {exc}")
            self.get_logger().info("cobotta_node:  [5/8] TakeArm ...")
            self.m_bcapclient.robot_execute(self.HRobot, "TakeArm", [0, 0])
            # COBOTTA servo-on prep (ROBOT-level commands, not controller):
            # ManualResetPreparation then MotionPreparation, else Motor-on fails
            # 0x81501069 "Operation preparation is necessary".
            if self._cobotta_prep:
                self.get_logger().info(
                    "cobotta_node:  [6/8] robot ManualResetPreparation + MotionPreparation ...")
                self.m_bcapclient.robot_execute(self.HRobot, "ManualResetPreparation")
                self.m_bcapclient.robot_execute(self.HRobot, "MotionPreparation")
            # Motor-on requires this client to hold the controller's Executable
            # Token. If it errors 0x83501029 "Set IP address for the executable
            # token", set Executable Token to "Any" (or Ethernet + this client IP)
            # in the COBOTTA config (WINCAPS / pendant). See docs.
            self.get_logger().info("cobotta_node:  [7/8] Motor on ...")
            self.m_bcapclient.robot_execute(self.HRobot, "Motor", [1, 0])
            self.get_logger().info("cobotta_node:  [8/8] ExtSpeed ...")
            # ExtSpeed takes [speed, accel, decel] (%), per the official DENSO
            # b-CAP samples — a scalar errors 0x80070057 (E_INVALIDARG).
            self.m_bcapclient.robot_execute(
                self.HRobot, "ExtSpeed", [self._ext_speed, self._ext_speed, self._ext_speed]
            )
            self._hw_ok = True
            self.get_logger().info(
                f"cobotta_node: B-CAP connected (ExtSpeed={self._ext_speed})"
            )
        except Exception as exc:
            self.get_logger().fatal(
                f"cobotta_node: B-CAP connection failed — hardware disabled: {exc}"
            )
            self._hw_ok = False

    def _disconnect(self):
        if not self._hw_ok:
            return
        with self._bcap_lock:
            try:
                self.m_bcapclient.robot_execute(self.HRobot, "Motor", [0, 0])
                self.m_bcapclient.robot_execute(self.HRobot, "GiveArm")
                self.m_bcapclient.controller_disconnect(self.hCtrl)
                self.m_bcapclient.service_stop()
                self.get_logger().info("cobotta_node: B-CAP disconnected cleanly")
            except Exception as exc:
                self.get_logger().warning(f"cobotta_node: error during disconnect: {exc}")

    # ── motion service handler ────────────────────────────────────────────────

    def _move_target_cb(self, request, response):
        """Handle /cobotta/move_target — blocks until robot_move completes.

        One reconnect + retry on the first B-CAP exception. All socket access is
        serialized by self._bcap_lock (shared with the encoder-read timer), and the
        reconnect runs _connect_locked() because the lock is already held.
        """
        if not self._hw_ok:
            response.ok = False
            response.message = "hardware disabled"
            return response

        if not request.hand_only and len(request.joints) < 6:
            response.ok = False
            response.message = f"expected 6 joints, got {len(request.joints)}"
            return response

        last_exc = None
        with self._bcap_lock:
            for attempt in range(2):  # first attempt + one retry
                try:
                    if request.hand_only:
                        self.m_bcapclient.controller_execute(
                            self.hCtrl, "HandMoveA", [request.hand, 100])
                        self.get_logger().info(f"cobotta_node: HandMoveA hand={request.hand}")
                    else:
                        j1, j2, j3, j4, j5, j6 = [float(v) for v in request.joints[:6]]
                        pose_str = f"@P J({j1},{j2},{j3},{j4},{j5},{j6})"
                        self.m_bcapclient.robot_move(self.HRobot, 1, pose_str)
                        self.m_bcapclient.controller_execute(
                            self.hCtrl, "HandMoveA", [request.hand, 100])
                        self.get_logger().info(f"cobotta_node: PTP → {pose_str} hand={request.hand}")
                    response.ok = True
                    response.message = ""
                    return response
                except Exception as exc:
                    last_exc = exc
                    if attempt == 0:
                        self.get_logger().warning(
                            f"cobotta_node: move_target failed, reconnect + retry: {exc}")
                        self._hw_ok = False
                        self._connect_locked()  # caller already holds self._bcap_lock
                        if not self._hw_ok:
                            self.get_logger().error("cobotta_node: reconnect failed, giving up")
                            break
                    else:
                        self.get_logger().error(f"cobotta_node: move_target failed after retry: {exc}")

        # Return a generic message — raw B-CAP error strings can leak internal info.
        self.get_logger().error(f"cobotta_node: move_target giving up: {last_exc}")
        response.ok = False
        response.message = "robot arm error — see cobotta_node log"
        return response

    # ── encoder feedback (closed loop) ─────────────────────────────────────────

    def _publish_real_joint_state(self):
        """Read the arm's encoders (CurJnt) and publish them as /cobotta/joint_states_real.

        Non-blocking on the lock: while a move holds the single B-CAP socket this skips
        and reads on the next tick. The arm is idle between moves — exactly when the app
        needs a fresh real seed for the next IK solve.
        """
        if not self._hw_ok or not self._bcap_lock.acquire(blocking=False):
            return
        try:
            cur = self.m_bcapclient.robot_execute(self.HRobot, "CurJnt")
        except Exception as exc:
            self.get_logger().warning(f"cobotta_node: CurJnt read failed: {exc}")
            return
        finally:
            self._bcap_lock.release()

        js = JointState()
        js.header.stamp = self.get_clock().now().to_msg()
        js.name = [f"joint{i}" for i in range(1, 7)]
        js.position = [convert_grad_to_rad(float(cur[i])) for i in range(6)]
        self._real_pub.publish(js)

    # ── cleanup ───────────────────────────────────────────────────────────────

    def destroy_node(self):
        self._disconnect()
        super().destroy_node()


def main(args=None):
    rclpy.init(args=args)
    node = HardwareControl()
    node.get_logger().info("cobotta_node started")

    def _sigterm_handler(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, _sigterm_handler)
    # MultiThreadedExecutor so the mutually-exclusive service callback can block
    # without freezing the rest of the node (see _move_target_cb).
    executor = MultiThreadedExecutor()
    executor.add_node(node)
    try:
        executor.spin()
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
