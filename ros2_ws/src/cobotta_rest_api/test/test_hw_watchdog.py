"""Unit tests for cobotta_node.HardwareControl robustness fixes:
encoder-link watchdog, malformed-CurJnt guard, move_target joint-limit
rejection, and the halt-channel teardown-on-shutdown leak.

B-CAP fully mocked — same pattern as test_halt_node.py.

Run (ROS-sourced env, after colcon build):
    cd ros2_ws && colcon build --packages-select cobotta_rest_api
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest src/cobotta_rest_api/test/test_hw_watchdog.py -v
"""
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
import rclpy

from cobotta_rest_api import cobotta_node as cn


@pytest.fixture(scope="module", autouse=True)
def _ros_context():
    rclpy.init()
    yield
    rclpy.shutdown()


@pytest.fixture
def node(monkeypatch):
    monkeypatch.setattr(cn, "bcapclient", MagicMock())
    n = cn.HardwareControl()

    n.m_bcapclient = MagicMock()
    n.hCtrl = MagicMock()
    n.HRobot = MagicMock()
    n._hw_ok = True

    n._halt_bcap = MagicMock()
    n._halt_ctrl = MagicMock()
    n._halt_robot = MagicMock()

    yield n
    n.destroy_node()


# ── encoder watchdog (F4) ─────────────────────────────────────────────────────

def test_encoder_failure_below_threshold_keeps_hw_ok(node):
    node.m_bcapclient.robot_execute.side_effect = RuntimeError("timeout")

    for _ in range(cn.ENCODER_FAIL_THRESHOLD - 1):
        node._publish_real_joint_state()

    assert node._hw_ok is True


def test_encoder_failure_at_threshold_marks_hw_down(node):
    node.m_bcapclient.robot_execute.side_effect = RuntimeError("timeout")

    for _ in range(cn.ENCODER_FAIL_THRESHOLD):
        node._publish_real_joint_state()

    assert node._hw_ok is False


def test_encoder_success_resets_fail_count(node):
    node.m_bcapclient.robot_execute.side_effect = RuntimeError("timeout")
    for _ in range(cn.ENCODER_FAIL_THRESHOLD - 1):
        node._publish_real_joint_state()
    assert node._encoder_fail_count == cn.ENCODER_FAIL_THRESHOLD - 1

    node.m_bcapclient.robot_execute.side_effect = None
    node.m_bcapclient.robot_execute.return_value = [0.0] * 6
    node._publish_real_joint_state()

    assert node._encoder_fail_count == 0
    assert node._hw_ok is True


# ── recovery: the timer must retry a reconnect once _hw_ok is False (W3.2) ──
# Before this fix, nothing ever retried the b-CAP connection once _hw_ok went
# False: _move_target_cb refused to even attempt a move while _hw_ok was
# False, so the exception its own reconnect-and-retry logic needs never
# happened — a transient link drop disabled the real arm until the node was
# restarted.

def test_timer_reconnects_once_hw_marked_down(node, monkeypatch):
    node._hw_ok = False
    node._encoder_fail_count = cn.ENCODER_FAIL_THRESHOLD
    node._last_reconnect_attempt = 0.0
    # _connect_locked() rebuilds self.m_bcapclient via the (mocked) bcapclient
    # class — a fresh instance with no side effects means the reconnect
    # sequence runs clean and succeeds.
    monkeypatch.setattr(cn, "bcapclient", MagicMock(return_value=MagicMock()))

    node._publish_real_joint_state()

    assert node._hw_ok is True
    assert node._encoder_fail_count == 0


def test_timer_reconnect_attempt_is_rate_limited(node, monkeypatch):
    node._hw_ok = False
    node._last_reconnect_attempt = 0.0
    monkeypatch.setattr(cn, "bcapclient", MagicMock(side_effect=RuntimeError("still down")))

    node._publish_real_joint_state()
    first_attempt_ts = node._last_reconnect_attempt
    assert first_attempt_ts != 0.0
    assert node._hw_ok is False  # reconnect failed, as configured above

    node._publish_real_joint_state()  # immediately again — must be skipped

    assert node._last_reconnect_attempt == first_attempt_ts


# ── malformed CurJnt response guard (F5) ─────────────────────────────────────

def test_encoder_short_response_does_not_raise(node):
    """A malformed CurJnt reply (None or too few values) used to crash the
    timer callback outside the try/except — must now be caught as a failure."""
    node.m_bcapclient.robot_execute.return_value = None
    node._publish_real_joint_state()  # must not raise
    assert node._encoder_fail_count == 1

    node.m_bcapclient.robot_execute.return_value = [1.0, 2.0, 3.0]  # only 3
    node._publish_real_joint_state()  # must not raise
    assert node._encoder_fail_count == 2


# ── move_target joint-limit rejection (F7) ───────────────────────────────────

def test_move_target_rejects_out_of_range_joint(node):
    joints = [0.0, 0.0, 90.0, 0.0, 0.0, 0.0]
    joints[2] = 999.0  # joint_3 limit is (18.0, 140.0)
    request = SimpleNamespace(hand_only=False, joints=joints, hand=15.0)
    response = SimpleNamespace()

    result = node._move_target_cb(request, response)

    assert result.ok is False
    assert "joint_3" in result.message
    node.m_bcapclient.robot_move.assert_not_called()


def test_move_target_rejects_out_of_range_hand(node):
    request = SimpleNamespace(hand_only=False, joints=[0.0, 0.0, 90.0, 0.0, 0.0, 0.0], hand=999.0)
    response = SimpleNamespace()

    result = node._move_target_cb(request, response)

    assert result.ok is False
    assert "hand" in result.message
    node.m_bcapclient.robot_move.assert_not_called()


def test_move_target_accepts_in_range_joints(node):
    node.m_bcapclient.robot_move.return_value = None
    node.m_bcapclient.robot_execute.return_value = 10.0
    request = SimpleNamespace(hand_only=False, joints=[0.0, 0.0, 90.0, 0.0, 0.0, 0.0], hand=15.0)
    response = SimpleNamespace()

    result = node._move_target_cb(request, response)

    assert result.ok is True
    node.m_bcapclient.robot_move.assert_called_once()


def test_move_target_hand_only_skips_joint_check(node):
    """hand_only=True must not validate request.joints (which the JOINT_
    LIMITS_DEG loop would otherwise zip against for a hand-only request)."""
    node.m_bcapclient.controller_execute.return_value = None
    request = SimpleNamespace(hand_only=True, joints=[], hand=15.0)
    response = SimpleNamespace()

    result = node._move_target_cb(request, response)

    assert result.ok is True


# ── halt-channel teardown on shutdown (F10) ──────────────────────────────────

def test_disconnect_tears_down_halt_channel_even_when_main_link_down(node):
    """Previously _disconnect() early-returned on `not self._hw_ok` before
    reaching the halt-channel teardown, leaking the halt socket whenever the
    main session was already down at shutdown."""
    node._hw_ok = False  # main link already down
    halt_bcap = node._halt_bcap  # capture before teardown nulls the attribute

    node._disconnect()

    halt_bcap.service_stop.assert_called_once()
    assert node._halt_bcap is None
