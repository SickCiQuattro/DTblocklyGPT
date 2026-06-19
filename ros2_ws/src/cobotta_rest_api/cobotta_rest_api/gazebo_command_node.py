"""
Gazebo Command Node - Nodo ROS2 per inviare comandi al robot simulato in Gazebo

Sottoscrive /move_joint e pubblica su /joint1_cmd, /joint2_cmd, ..., /joint_left_cmd, /joint_right_cmd
"""

import rclpy
from rclpy.node import Node

from sensor_msgs.msg import JointState
from std_msgs.msg import Float64

from .cobotta_utils import convert_hand_cobotta_gazebo, convert_grad_to_rad


class GazeboCommandNode(Node):
    def __init__(self):
        super().__init__("gazebo_command_node")

        # Subscriber per comandi di movimento
        self.sub_joint_states = self.create_subscription(
            JointState, "/move_joint", self.move_joint_callback, 10
        )

        # Publisher per ogni joint di Gazebo
        self.pub_gazebo_j1 = self.create_publisher(Float64, "/joint1_cmd", 10)
        self.pub_gazebo_j2 = self.create_publisher(Float64, "/joint2_cmd", 10)
        self.pub_gazebo_j3 = self.create_publisher(Float64, "/joint3_cmd", 10)
        self.pub_gazebo_j4 = self.create_publisher(Float64, "/joint4_cmd", 10)
        self.pub_gazebo_j5 = self.create_publisher(Float64, "/joint5_cmd", 10)
        self.pub_gazebo_j6 = self.create_publisher(Float64, "/joint6_cmd", 10)
        self.pub_gazebo_hand_left = self.create_publisher(Float64, "/joint_left_cmd", 10)
        self.pub_gazebo_hand_right = self.create_publisher(Float64, "/joint_right_cmd", 10)

        self.get_logger().info("Gazebo Command Node initialized")

    def move_joint_callback(self, joint_msg):
        """
        Callback che riceve comandi di movimento e li inoltra a Gazebo

        Args:
            joint_msg: JointState con posizioni joint in GRADI (da convertire in radianti per Gazebo)
        """
        if len(joint_msg.position) < 7:
            self.get_logger().error(
                f"/move_joint expects >= 7 positions, got {len(joint_msg.position)} — ignoring"
            )
            return
        j1, j2, j3, j4, j5, j6, hand = joint_msg.position[:7]

        self.get_logger().info(
            f"Received movement command (deg): joints=[{j1:.2f}, {j2:.2f}, {j3:.2f}, {j4:.2f}, {j5:.2f}, {j6:.2f}], hand={hand:.2f}")

        # Passa i valori a Gazebo convertendo i gradi in radianti
        msg_j = [
            Float64(data=convert_grad_to_rad(j1)),
            Float64(data=convert_grad_to_rad(j2)),
            Float64(data=convert_grad_to_rad(j3)),
            Float64(data=convert_grad_to_rad(j4)),
            Float64(data=convert_grad_to_rad(j5)),
            Float64(data=convert_grad_to_rad(j6)),
            Float64(data=convert_hand_cobotta_gazebo(hand)),
        ]
        msg_j1, msg_j2, msg_j3, msg_j4, msg_j5, msg_j6, msg_hand = msg_j

        # Pubblica su ogni topic Gazebo
        publishers = [
            self.pub_gazebo_j1,
            self.pub_gazebo_j2,
            self.pub_gazebo_j3,
            self.pub_gazebo_j4,
            self.pub_gazebo_j5,
            self.pub_gazebo_j6,
            self.pub_gazebo_hand_left,
            self.pub_gazebo_hand_right,
        ]

        for msg, publisher in zip([msg_j1, msg_j2, msg_j3, msg_j4, msg_j5, msg_j6, msg_hand, msg_hand], publishers):
            publisher.publish(msg)


def main(args=None):
    rclpy.init(args=args)

    gazebo_node = GazeboCommandNode()
    print("gazebo_command_node started")

    rclpy.spin(gazebo_node)

    gazebo_node.destroy_node()
    rclpy.shutdown()


if __name__ == "__main__":
    main()
