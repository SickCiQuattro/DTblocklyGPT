import json
import signal
import threading
import time

import rclpy
from rclpy.node import Node
from rclpy.callback_groups import MutuallyExclusiveCallbackGroup, ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from sensor_msgs.msg import JointState
from std_srvs.srv import Trigger

from .orin.bcapclient import BCAPClient as bcapclient
from .cobotta_utils import convert_grad_to_rad, JOINT_LIMITS_DEG

from my_robot_interfaces.srv import MoveTarget

# Consecutive encoder-read failures before the link is declared down. The
# encoder timer runs at 10 Hz, so 3 is ~0.3s of consistently failing reads —
# long enough to not flag a single transient b-CAP hiccup, short enough that
# a genuinely dead link is caught well before the next move attempt.
ENCODER_FAIL_THRESHOLD = 3

# How often the encoder timer retries a b-CAP reconnect once the link is
# marked down. Frequent enough to recover promptly from a transient drop,
# not so frequent it hammers the socket every 100ms while genuinely offline.
HW_RECONNECT_INTERVAL_S = 2.0


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

        # Second, independent B-CAP session used only to send Halt while the main
        # session may be blocked inside a robot_move PTP. Own socket, own lock —
        # never touches self._bcap_lock so it can't be starved by a hung move.
        self._halt_bcap = None
        self._halt_ctrl = None
        self._halt_robot = None
        self._halt_lock = threading.Lock()
        # Set before Halt is sent, cleared when a new move request comes in. Lets
        # _move_target_cb tell "halted on purpose" apart from a real B-CAP error
        # so it does not reconnect-and-retry the move that was just halted.
        self._halt_requested = threading.Event()

        # Consecutive CurJnt read failures on the encoder timer. The b-CAP link
        # can drop between moves (nothing else touches it then), and the timer
        # is the only thing polling it — this counter is what turns repeated
        # failures into _hw_ok going False, instead of the timer just logging
        # a warning and ticking forever with a dead link.
        self._encoder_fail_count = 0
        # Rate-limits the timer's reconnect attempts once _hw_ok goes False —
        # without this, a link drop disables the arm permanently:
        # _move_target_cb refuses to even try a move while _hw_ok is False,
        # so nothing generates the exception its own retry logic needs.
        self._last_reconnect_attempt = 0.0

        self._enable_hardware = enable_hardware
        if enable_hardware:
            self._connect()
            self._connect_halt()
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

        # Halt channel: separate callback group so it is scheduled even while
        # _move_target_cb is blocked inside a PTP (both groups run concurrently
        # under the MultiThreadedExecutor in main()).
        self._halt_cb_group = MutuallyExclusiveCallbackGroup()
        self.create_service(
            Trigger,
            "/cobotta/halt",
            self._halt_cb,
            callback_group=self._halt_cb_group,
        )

        # Closed loop: publish the real arm's encoder state so the app can seed IK
        # from the physical robot (not the Gazebo twin). Separate topic so it does
        # not collide with the sim's joint_state_broadcaster on /joint_states.
        self._real_pub = self.create_publisher(JointState, "/cobotta/joint_states_real", 10)
        # Not gated on self._hw_ok: the timer is also what retries the
        # b-CAP connection once the link is down, including when the initial
        # connect above failed — without the timer running, nothing would ever
        # attempt a reconnect at all.
        if enable_hardware:
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
        # Halt channel is independent of the main session's _hw_ok — tear it
        # down unconditionally, otherwise a halt socket connected while the
        # main link was already down leaks past shutdown.
        with self._halt_lock:
            self._disconnect_halt_locked()

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

    # ── halt channel (second B-CAP session) ─────────────────────────────────────

    def _connect_halt(self):
        """Best-effort: a missing halt channel must never block startup or a move.

        No TakeArm / Motor / ExtSpeed here — the main session owns the arm; Halt
        does not require the executable token, only a live controller handle.
        """
        self.get_logger().info("cobotta_node: connecting halt channel ...")
        with self._halt_lock:
            self._connect_halt_locked()
        if self._halt_bcap is not None:
            self.get_logger().info("cobotta_node: halt channel connected")

    def _disconnect_halt_locked(self):
        """Best-effort teardown. Caller MUST hold self._halt_lock."""
        if self._halt_bcap is None:
            return
        try:
            if self._halt_ctrl is not None:
                self._halt_bcap.controller_disconnect(self._halt_ctrl)
            self._halt_bcap.service_stop()
        except Exception as exc:
            self.get_logger().warning(f"cobotta_node: error during halt disconnect: {exc}")
        finally:
            self._halt_bcap = None
            self._halt_ctrl = None
            self._halt_robot = None

    def _connect_halt_locked(self):
        """Raw halt-channel connect. Caller MUST hold self._halt_lock."""
        try:
            self._halt_bcap = bcapclient(self.host, self.port, self._connect_timeout)
            self._halt_bcap.service_start("")
            self._halt_bcap.settimeout(5.0)
            self._halt_ctrl = self._halt_bcap.controller_connect(
                "", self._provider, "localhost", ""
            )
            self._halt_robot = self._halt_bcap.controller_getrobot(self._halt_ctrl, "Arm0")
        except Exception as exc:
            self.get_logger().warning(f"cobotta_node: halt channel connect failed: {exc}")
            self._halt_bcap = None
            self._halt_ctrl = None
            self._halt_robot = None

    def _halt_cb(self, _request, response):
        """Handle /cobotta/halt — sends Halt on the second session, motors stay on.

        Not a safety stop: this is best-effort operational reliability. The
        teach-pendant deadman / e-stop remains the only safety-rated stop.
        """
        if not self._hw_ok:
            response.success = False
            response.message = "hardware disabled"
            return response

        # Set BEFORE sending Halt: even if this call fails after the arm already
        # started decelerating, _move_target_cb must not reconnect-and-retry the
        # move that is being halted.
        self._halt_requested.set()

        last_exc = None
        with self._halt_lock:
            for attempt in range(2):  # first attempt + one reconnect retry
                if self._halt_bcap is None:
                    self._connect_halt_locked()
                if self._halt_bcap is not None:
                    try:
                        self._halt_bcap.robot_halt(self._halt_robot)
                        self.get_logger().info("cobotta_node: Halt sent on halt channel")
                        response.success = True
                        response.message = ""
                        return response
                    except Exception as exc:
                        last_exc = exc
                        self._disconnect_halt_locked()
                if attempt == 0:
                    self.get_logger().warning(
                        f"cobotta_node: halt failed, reconnect + retry: {last_exc}")

        self.get_logger().error(f"cobotta_node: halt failed after retry: {last_exc}")
        response.success = False
        response.message = "halt failed — use e-stop"
        return response

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

        # Flask clamps before calling this service, but a caller hitting
        # /cobotta/move_target directly bypasses that — reject out-of-range
        # targets here too rather than sending them to the real arm and
        # relying on the RC8 firmware as the only backstop.
        if not request.hand_only:
            limit_keys = ["joint_1", "joint_2", "joint_3", "joint_4", "joint_5", "joint_6"]
            for lk, v in zip(limit_keys, request.joints[:6]):
                lo, hi = JOINT_LIMITS_DEG[lk]
                if not (lo <= v <= hi):
                    response.ok = False
                    response.message = f"{lk}={v} out of limits [{lo}, {hi}]"
                    return response
        lo, hi = JOINT_LIMITS_DEG["hand"]
        if not (lo <= request.hand <= hi):
            response.ok = False
            response.message = f"hand={request.hand} out of limits [{lo}, {hi}]"
            return response

        last_exc = None
        with self._bcap_lock:
            # A fresh move request supersedes any earlier halt.
            self._halt_requested.clear()
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
                    response.message = self._read_hand_pos_json()
                    return response
                except Exception as exc:
                    last_exc = exc
                    if self._halt_requested.is_set():
                        # Halted on purpose — do not reconnect and replay the move.
                        response.ok = False
                        response.message = "halted by operator"
                        return response
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

    def _read_hand_pos_json(self) -> str:
        """Best-effort gripper-aperture readout, piggybacked on a successful move.

        Non-fatal by design: an app-side grasp check should degrade to "no data",
        never fail the move itself. Caller MUST hold self._bcap_lock.
        """
        try:
            hand_pos = self.m_bcapclient.robot_execute(self.HRobot, "HandCurPos")
            return json.dumps({"hand_mm": float(hand_pos)})
        except Exception as exc:
            self.get_logger().warning(f"cobotta_node: HandCurPos read failed: {exc}")
            return ""

    # ── encoder feedback (closed loop) ─────────────────────────────────────────

    def _try_reconnect_from_timer(self):
        """Retry the b-CAP connection while the link is marked down.

        Called from the encoder timer — without this, ENCODER_FAIL_THRESHOLD
        consecutive failures (~0.3s) would disable the real arm until the
        node was restarted: _move_target_cb refuses to even attempt a move
        while _hw_ok is False, so nothing else would generate the exception
        its own reconnect-and-retry needs. Rate-limited so a genuinely
        offline link doesn't get hammered every 100ms, and non-blocking on
        the lock so it never fights an in-flight move for the socket.
        """
        now = time.monotonic()
        if now - self._last_reconnect_attempt < HW_RECONNECT_INTERVAL_S:
            return
        self._last_reconnect_attempt = now
        if not self._bcap_lock.acquire(blocking=False):
            return
        try:
            self.get_logger().info("cobotta_node: encoder timer retrying b-CAP reconnect ...")
            self._connect_locked()
            if self._hw_ok:
                self._encoder_fail_count = 0
                self.get_logger().info("cobotta_node: b-CAP link recovered")
        finally:
            self._bcap_lock.release()

    def _publish_real_joint_state(self):
        """Read the arm's encoders (CurJnt) and publish them as /cobotta/joint_states_real.

        Non-blocking on the lock: while a move holds the single B-CAP socket this skips
        and reads on the next tick. The arm is idle between moves — exactly when the app
        needs a fresh real seed for the next IK solve.
        """
        if not self._hw_ok:
            self._try_reconnect_from_timer()
            return
        if not self._bcap_lock.acquire(blocking=False):
            return
        try:
            cur = self.m_bcapclient.robot_execute(self.HRobot, "CurJnt")
            if cur is None or len(cur) < 6:
                raise ValueError(f"CurJnt returned {cur!r}, expected 6 values")
        except Exception as exc:
            self.get_logger().warning(f"cobotta_node: CurJnt read failed: {exc}")
            self._encoder_fail_count += 1
            if self._encoder_fail_count >= ENCODER_FAIL_THRESHOLD:
                self._hw_ok = False
                self.get_logger().error(
                    f"cobotta_node: b-CAP link lost ({ENCODER_FAIL_THRESHOLD} consecutive "
                    "encoder failures) — hardware marked down")
            return
        finally:
            self._bcap_lock.release()

        self._encoder_fail_count = 0
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
