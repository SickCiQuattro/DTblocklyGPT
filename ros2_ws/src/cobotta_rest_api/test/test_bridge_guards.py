"""Unit tests for bridge_node_ROS.BridgeNodeROS robustness fixes:
execute_path rejecting commands when no controller is subscribed, the
stop-window that makes a /stop win over a command already in flight, and
get_health reporting real controller/hardware-link state.

Publishers are swapped for MagicMocks so subscription-count and publish can
be controlled directly — real gz/controller_manager discovery timing is not
under test here (that's the live-verification checklist).

Run (ROS-sourced env, after colcon build):
    cd ros2_ws && colcon build --packages-select cobotta_rest_api
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest src/cobotta_rest_api/test/test_bridge_guards.py -v
"""
import time
from unittest.mock import MagicMock

import pytest
import rclpy

from cobotta_rest_api import bridge_node_ROS as bn


@pytest.fixture(scope="module", autouse=True)
def _ros_context():
    rclpy.init()
    yield
    rclpy.shutdown()


@pytest.fixture
def node():
    n = bn.BridgeNodeROS()
    n.arm_traj_pub = MagicMock()
    n.arm_traj_pub.get_subscription_count.return_value = 1
    n.gripper_traj_pub = MagicMock()
    n.gripper_traj_pub.get_subscription_count.return_value = 1
    yield n
    n.destroy_node()


_WP = [{"j1": 0.0, "j2": 0.0, "j3": 0.0, "j4": 0.0, "j5": 0.0, "j6": 0.0, "hand": 0.0, "dt": 0.1}]


# ── execute_path rejects when no controller listening (F2) ──────────────────

def test_execute_path_succeeds_with_subscribers(node):
    assert node.execute_path(_WP) is True
    node.arm_traj_pub.publish.assert_called_once()
    node.gripper_traj_pub.publish.assert_called_once()


def test_execute_path_rejected_when_arm_controller_down(node):
    node.arm_traj_pub.get_subscription_count.return_value = 0

    assert node.execute_path(_WP) is False
    node.arm_traj_pub.publish.assert_not_called()
    node.gripper_traj_pub.publish.assert_not_called()


def test_execute_path_rejected_when_gripper_controller_down(node):
    node.gripper_traj_pub.get_subscription_count.return_value = 0

    assert node.execute_path(_WP) is False
    node.arm_traj_pub.publish.assert_not_called()


def test_execute_path_rejects_empty_waypoints(node):
    assert node.execute_path([]) is False
    node.arm_traj_pub.publish.assert_not_called()


# ── stop-window (F6) ──────────────────────────────────────────────────────────

def test_execute_path_rejected_right_after_stop(node):
    node.stop_path()
    node.arm_traj_pub.publish.reset_mock()  # stop_path's own empty-trajectory publish

    assert node.execute_path(_WP) is False
    node.arm_traj_pub.publish.assert_not_called()


def test_execute_path_allowed_after_stop_window_elapses(node, monkeypatch):
    node.stop_path()
    # Fast-forward past STOP_WINDOW_S without a real sleep.
    monkeypatch.setattr(node, "_last_stop_ts", time.monotonic() - bn.STOP_WINDOW_S - 0.1)

    assert node.execute_path(_WP) is True


def test_stop_path_always_publishes_regardless_of_subscribers(node):
    node.arm_traj_pub.get_subscription_count.return_value = 0

    assert node.stop_path() is True
    node.arm_traj_pub.publish.assert_called_once()
    node.gripper_traj_pub.publish.assert_called_once()


# ── get_health truthfulness (F3, F9) ─────────────────────────────────────────

def test_health_reports_controllers_listening_true(node):
    health = node.get_health()
    assert health["gazebo"]["controllers_listening"] is True


def test_health_reports_controllers_listening_false(node):
    node.arm_traj_pub.get_subscription_count.return_value = 0
    health = node.get_health()
    assert health["gazebo"]["controllers_listening"] is False


def test_health_link_ok_false_when_no_encoder_data(node):
    health = node.get_health()
    assert health["hardware"]["link_ok"] is False


def test_health_link_ok_true_with_fresh_encoder_data(node):
    node._last_real_time = time.monotonic()
    health = node.get_health()
    assert health["hardware"]["link_ok"] is True


def test_health_link_ok_false_with_stale_encoder_data(node):
    node._last_real_time = time.monotonic() - 5.0
    health = node.get_health()
    assert health["hardware"]["link_ok"] is False
