import signal

import rclpy
from rclpy.node import Node
from rclpy.callback_groups import MutuallyExclusiveCallbackGroup
from rclpy.executors import MultiThreadedExecutor

from .orin.bcapclient import BCAPClient as bcapclient

from my_robot_interfaces.srv import MoveTarget


class HardwareControl(Node):
    """Physical-robot node (Denso Cobotta via B-CAP/RC8).

    Opt-in: set enable_hardware:=true to connect real hardware.
    Serves /cobotta/move_target service (absolute joint degrees), sends one PTP
    robot_move per request. Gazebo is driven separately by gazebo_command_node.

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
        # ORiN/CAO provider: "CaoProv.DENSO.RC8" for the physical COBOTTA/RC8
        # controller; "CaoProv.DENSO.VRC" is the virtual (WINCAPS) simulator only.
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

        if enable_hardware:
            self._connect()
        else:
            self.get_logger().info(
                "cobotta_node: enable_hardware=false — hardware disabled, no B-CAP connection."
            )

        # Serve the synchronous move-target channel (absolute joint degrees).
        # The 50 Hz /move_joint stream goes to gazebo_command_node only.
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
        self.get_logger().info("cobotta_node ready — serving /cobotta/move_target")

    # ── B-CAP lifecycle ───────────────────────────────────────────────────────

    def _connect(self):
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
                self.get_logger().info("cobotta_node:  [4/8] ManualResetPreparation + ClearError ...")
                try:
                    self.m_bcapclient.controller_execute(self.hCtrl, "ManualResetPreparation")
                    self.m_bcapclient.controller_execute(self.hCtrl, "ClearError")
                except Exception as exc:
                    self.get_logger().warning(f"cobotta_node: pre-clear failed (continuing): {exc}")
            self.get_logger().info("cobotta_node:  [5/8] TakeArm ...")
            self.m_bcapclient.robot_execute(self.HRobot, "TakeArm", [0, 0])
            # COBOTTA servo-on prep (ROBOT-level commands, not controller):
            # ManualResetPreparation then MotionPreparation, else Motor-on fails
            # 0x81501069 "Operation preparation is necessary".
            if self._cobotta_prep:
                self.get_logger().info("cobotta_node:  [6/8] robot ManualResetPreparation + MotionPreparation ...")
                self.m_bcapclient.robot_execute(self.HRobot, "ManualResetPreparation")
                self.m_bcapclient.robot_execute(self.HRobot, "MotionPreparation")
            # Motor-on requires this client to hold the controller's Executable
            # Token. If it errors 0x83501029 "Set IP address for the executable
            # token", set Executable Token to "Any" (or Ethernet + this client IP)
            # in the COBOTTA config (WINCAPS / pendant). See docs.
            self.get_logger().info("cobotta_node:  [7/8] Motor on ...")
            self.m_bcapclient.robot_execute(self.HRobot, "Motor", [1, 0])
            self.get_logger().info("cobotta_node:  [8/8] ExtSpeed ...")
            self.m_bcapclient.robot_execute(self.HRobot, "ExtSpeed", self._ext_speed)
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
        """Handle /cobotta/move_target service call — blocks until robot_move completes.

        Implements retry logic: on first exception, attempts one reconnect followed by
        a single retry of the move. If reconnect or retry fails, returns ok=False.
        """
        if not self._hw_ok:
            response.ok = False
            response.message = "hardware disabled"
            return response

        attempt = 0
        max_attempts = 2  # first attempt + one retry
        last_exc = None

        while attempt < max_attempts:
            try:
                if request.hand_only:
                    self.m_bcapclient.controller_execute(
                        self.hCtrl, "HandMoveA", [request.hand, 100]
                    )
                    self.get_logger().info(f"cobotta_node: HandMoveA hand={request.hand}")
                else:
                    if len(request.joints) < 6:
                        response.ok = False
                        response.message = f"expected 6 joints, got {len(request.joints)}"
                        return response
                    j1, j2, j3, j4, j5, j6 = [float(v) for v in request.joints[:6]]
                    pose_str = f"@P J({j1},{j2},{j3},{j4},{j5},{j6})"
                    self.m_bcapclient.robot_move(self.HRobot, 1, pose_str)
                    self.m_bcapclient.controller_execute(
                        self.hCtrl, "HandMoveA", [request.hand, 100]
                    )
                    self.get_logger().info(f"cobotta_node: PTP → {pose_str} hand={request.hand}")
                response.ok = True
                response.message = ""
                return response
            except Exception as exc:
                last_exc = exc
                attempt += 1
                if attempt < max_attempts:
                    self.get_logger().warning(
                        f"cobotta_node: move_target attempt {attempt} failed, retrying after reconnect: {exc}"
                    )
                    self._hw_ok = False
                    self._connect()
                    if not self._hw_ok:
                        self.get_logger().error(
                            "cobotta_node: reconnect failed, giving up"
                        )
                        break
                else:
                    self.get_logger().error(f"cobotta_node: move_target failed after retry: {exc}")

        # Log the raw exception (above) but return a generic message to the caller —
        # raw B-CAP error strings can leak internal paths / protocol dumps.
        self.get_logger().error(f"cobotta_node: move_target giving up: {last_exc}")
        response.ok = False
        response.message = "robot arm error — see cobotta_node log"
        return response

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
