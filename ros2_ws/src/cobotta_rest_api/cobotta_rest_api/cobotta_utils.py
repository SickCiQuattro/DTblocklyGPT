import math


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
