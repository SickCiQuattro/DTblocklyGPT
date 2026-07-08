"""Unit tests for the /cobotta/halt channel in cobotta_node.HardwareControl.

B-CAP is fully mocked (no real hardware, no network). Tests call the node's
internal callbacks directly instead of going through the ROS service layer —
same granularity as the parser-level tests in testing/test_hw_parser_compat.py.

Run (ROS-sourced env, after colcon build):
    cd ros2_ws && colcon build --packages-select cobotta_rest_api
    source install/setup.bash
    # PYTEST_DISABLE_PLUGIN_AUTOLOAD: the launch_testing_ros pytest plugin
    # intercepts plain .py collection and mis-resolves `cobotta_rest_api`
    # against the (stray, empty) package-root __init__.py instead of the
    # installed module — unrelated to this test, sidestep it entirely.
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest src/cobotta_rest_api/test/test_halt_node.py -v
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
    """A HardwareControl with both B-CAP sessions faked as already-connected.

    enable_hardware stays at its False default so __init__ does not attempt a
    real connect; the "connected" state is set up by hand below so each test
    controls exactly what the mocked client does.
    """
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


def test_halt_cb_sends_halt_on_second_client(node):
    request = SimpleNamespace()
    response = SimpleNamespace()

    result = node._halt_cb(request, response)

    assert result.success is True
    node._halt_bcap.robot_halt.assert_called_once_with(node._halt_robot)
    # Never touches the main session's client.
    node.m_bcapclient.robot_halt.assert_not_called()
    assert node._halt_requested.is_set()


def test_halted_move_does_not_retry(node):
    """Halt racing in while robot_move is blocked must not trigger a reconnect+retry
    that would replay the just-halted move."""

    def move_side_effect(*_a, **_kw):
        # Simulates /cobotta/halt landing on another thread while this call
        # was blocked inside b-CAP's robot_move.
        node._halt_requested.set()
        raise RuntimeError("motion stopped")

    node.m_bcapclient.robot_move.side_effect = move_side_effect
    node._connect_locked = MagicMock()  # would be called by the old retry path

    request = SimpleNamespace(hand_only=False, joints=[0.0] * 6, hand=30.0)
    response = SimpleNamespace()
    result = node._move_target_cb(request, response)

    assert result.ok is False
    assert result.message == "halted by operator"
    node._connect_locked.assert_not_called()
    assert node.m_bcapclient.robot_move.call_count == 1


def test_fresh_move_clears_stale_halt_flag(node):
    """A halt from an earlier, already-finished move must not poison the next one."""
    node._halt_requested.set()  # stale flag from a previous halt
    node.m_bcapclient.robot_move.return_value = None
    node.m_bcapclient.robot_execute.return_value = 10.0  # HandCurPos read

    request = SimpleNamespace(hand_only=False, joints=[0.0] * 6, hand=30.0)
    response = SimpleNamespace()
    result = node._move_target_cb(request, response)

    assert result.ok is True
    assert not node._halt_requested.is_set()


def test_halt_cb_survives_repeated_failure(node):
    """Both the direct attempt and the reconnect retry fail — no exception escapes,
    and the caller gets a clear "use e-stop" message instead of a crash."""
    # cn.bcapclient is a mocked class: every call (initial + the reconnect the
    # retry triggers) returns this same return_value, so the failure is sticky
    # across the reconnect the way a genuinely dead socket would be.
    cn.bcapclient.return_value.robot_halt.side_effect = RuntimeError("socket dead")
    node._halt_bcap = cn.bcapclient.return_value

    request = SimpleNamespace()
    response = SimpleNamespace()
    result = node._halt_cb(request, response)

    assert result.success is False
    assert "e-stop" in result.message
