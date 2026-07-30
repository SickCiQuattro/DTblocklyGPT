"""Gripper Cobotta<->Gazebo unit-conversion regression tests (offline, pure
math — no ROS, no Django models needed for the ROS-side half).

Run:
    poetry run python -m pytest testing/test_gripper_unit_conversion.py -v

Guards a real regression from 2026-07-30. The gripper's Gazebo range is
[-0.015, 0.0] metres per finger, declared on the joint_left/joint_right
prismatic joints in Cobotta.sdf.template — the model Gazebo loads for
physics (via .gen/Cobotta.sdf, written by cobotta_ros2_control.launch.py).

cobotta_ik.urdf declares [0, 0.01] for the same two joint names, but that
file only feeds robot_description/ikpy and its gripper limits do not describe
this joint. Taking those as the target, both conversion functions were
rewritten to map onto [0, 0.01] — every command then fell outside the real
range and got clamped to the same end for open AND close, so the gripper
stopped closing in the twin at all. These tests pin the SDF range so the
same substitution can't happen again silently.
"""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.insert(0, os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "ros2_ws", "src", "cobotta_rest_api", "cobotta_rest_api")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

try:
    import django
    django.setup()
except Exception:
    pass

# ROS-side conversion (cobotta_utils.py is pure math — importable without rclpy).
from cobotta_utils import convert_hand_cobotta_gazebo, convert_hand_gazebo_cobotta as ros_gazebo_to_cobotta
# Django-side conversion (must stay the exact algebraic inverse of the one above).
from backend.functions.simulate import convert_hand_gazebo_cobotta as django_gazebo_to_cobotta

# joint_left/joint_right in ros2_ws/Cobotta/Cobotta.sdf.template: prismatic,
# <limit><lower>-0.015</lower><upper>0</upper></limit>. Both fingers share it,
# and the <command_interface> min/max in cobotta_ik.urdf mirrors it (that pair
# is what gz_ros2_control clamps commands against).
GAZEBO_JOINT_MIN = -0.015
GAZEBO_JOINT_MAX = 0.0

# Cobotta hand aperture scale, per JOINT_LIMITS_DEG["hand"] in cobotta_utils.py.
COBOTTA_CLOSED = 0.0
COBOTTA_OPEN = 30.0


def test_full_cobotta_range_stays_within_gazebo_joint_limits():
    """The actual regression: every value in the usable Cobotta range must
    land inside the SDF's real joint limits, or gz_ros2_control clamps it and
    the fingers stop responding to that command."""
    for cobotta in [0, 5, 10, 15, 20, 25, 30]:
        gazebo = convert_hand_cobotta_gazebo(cobotta)
        assert GAZEBO_JOINT_MIN - 1e-9 <= gazebo <= GAZEBO_JOINT_MAX + 1e-9, (
            f"cobotta={cobotta} -> gazebo={gazebo}, outside SDF limit "
            f"[{GAZEBO_JOINT_MIN}, {GAZEBO_JOINT_MAX}] — would be clamped"
        )


def test_endpoints_map_to_the_full_gazebo_range():
    """Pins the direction: closed and open must map to the two distinct joint
    extremes. When both collapse to (near) the same value, open and close
    become the same command and the gripper visibly stops working."""
    assert abs(convert_hand_cobotta_gazebo(COBOTTA_CLOSED) - GAZEBO_JOINT_MIN) < 1e-9
    assert abs(convert_hand_cobotta_gazebo(COBOTTA_OPEN) - GAZEBO_JOINT_MAX) < 1e-9


def test_close_and_open_are_meaningfully_far_apart():
    """A conversion can sit inside the limits and still be useless if it
    compresses the whole scale into a sliver. close_gripper (10) vs
    open_gripper (30) must stay millimetres apart, not micrometres."""
    close = convert_hand_cobotta_gazebo(10)
    open_ = convert_hand_cobotta_gazebo(30)
    assert abs(open_ - close) > 0.005


def test_ros_side_round_trip():
    for cobotta in [0, 7.5, 15, 22.5, 30]:
        gazebo = convert_hand_cobotta_gazebo(cobotta)
        back = ros_gazebo_to_cobotta(gazebo)
        assert abs(back - cobotta) < 1e-6


def test_django_side_is_exact_inverse_of_ros_side():
    """The two conversion functions live in different processes/files
    (cobotta_utils.py for commanding, simulate.py for reading Gazebo joint
    feedback back via sync_current_state_from_ros) — they must be kept in
    lockstep by hand, there is no shared source of truth enforcing it."""
    for cobotta in [0, 7.5, 15, 22.5, 30]:
        gazebo = convert_hand_cobotta_gazebo(cobotta)
        assert abs(django_gazebo_to_cobotta(gazebo) - cobotta) < 1e-6
        assert abs(django_gazebo_to_cobotta(gazebo) - ros_gazebo_to_cobotta(gazebo)) < 1e-9


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-v"]))
