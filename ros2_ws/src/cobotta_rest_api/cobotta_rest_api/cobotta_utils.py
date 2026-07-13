import math

# Joint limits in degrees — from cobotta_description/urdf/cobotta.urdf (converted
# rad→deg). Shared by the Flask edge (clamps/UX) and the /cobotta/move_target ROS
# service (rejects — a caller that bypasses Flask and hits the service directly
# must not be able to send an out-of-range target to the real arm).
JOINT_LIMITS_DEG = {
    "joint_1": (-150.0, 150.0),
    "joint_2": (-60.0, 100.0),
    "joint_3": (18.0, 140.0),
    "joint_4": (-170.0, 170.0),
    "joint_5": (-95.0, 135.0),
    "joint_6": (-170.0, 170.0),
    "hand": (0.0, 30.0),
}


def convert_grad_to_rad(degrees):
    """Converte gradi in radianti"""
    return degrees * (math.pi / 180)


def convert_rad_to_grad(radians):
    """Converte radianti in gradi"""
    return radians * (180 / math.pi)


def convert_hand_cobotta_gazebo(cobotta_hand_value):
    """
    Converte valore hand Cobotta (0-30) in valore Gazebo

    Args:
        cobotta_hand_value: Valore apertura pinza da Cobotta (0-30)

    Returns:
        Valore per Gazebo
    """
    return cobotta_hand_value / 2000 - 0.015


def convert_hand_gazebo_cobotta(gazebo_hand_value):
    """
    Converte valore hand Gazebo in valore Cobotta (0-30)

    Args:
        gazebo_hand_value: Valore apertura pinza da Gazebo

    Returns:
        Valore per Cobotta (0-30)
    """
    return (gazebo_hand_value + 0.015) * 2000
