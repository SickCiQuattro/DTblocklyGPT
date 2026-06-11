import sys

import rclpy
from rclpy.node import Node

from .orin.bcapclient import BCAPClient as bcapclient
from .cobotta_utils import convert_grad_to_rad, convert_hand_cobotta_gazebo, convert_hand_gazebo_cobotta

from sensor_msgs.msg import JointState
from my_robot_interfaces.srv import PositionJoint
from my_robot_interfaces.srv import ListPosJoint
from my_robot_interfaces.msg import PosJoint
from std_msgs.msg import Float64


class HardwareControl(Node):
    """Physical-robot node (Denso Cobotta via B-CAP/RC8).

    The B-CAP connection bootstrap is disabled — the node subscribes to /move_joint
    but does not drive real hardware until the bcapclient block is re-enabled.
    See git history for the original connection code.
    Not launched by launch_sim.sh (Gazebo-only stack).
    Override hardware connection params at runtime:
        ros2 run cobotta_rest_api cobotta_node --ros-args -p bcap_host:=192.168.x.y
    """

    def __init__(self):
        super().__init__("cobotta_node")

        # B-CAP connection params — configurable via ROS parameters.
        self.declare_parameter("bcap_host", "192.168.0.1")
        self.declare_parameter("bcap_port", 5007)
        self.declare_parameter("bcap_timeout", 2000)
        self.host = self.get_parameter("bcap_host").value
        self.port = self.get_parameter("bcap_port").value
        self.timeout = self.get_parameter("bcap_timeout").value

        self.movements = 0
        self.joint_position = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
        self.current_pos = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]

        # set Parameter
        self.Name = ""
        self.Provider = "CaoProv.DENSO.VRC"
        self.Machine = "localhost"
        self.Option = ""

        self.comp = 1
        self.loopflg = True
        self.ESC = 0x1B  # [ESC] virtual key code
        self.sub_joint_states = self.create_subscription(
            JointState, "/move_joint", self.move_joint_callback, 10
        )

        self.pub_gazebo_j1 = self.create_publisher(Float64, "/joint1_cmd", 10)
        self.pub_gazebo_j2 = self.create_publisher(Float64, "/joint2_cmd", 10)
        self.pub_gazebo_j3 = self.create_publisher(Float64, "/joint3_cmd", 10)
        self.pub_gazebo_j4 = self.create_publisher(Float64, "/joint4_cmd", 10)
        self.pub_gazebo_j5 = self.create_publisher(Float64, "/joint5_cmd", 10)
        self.pub_gazebo_j6 = self.create_publisher(Float64, "/joint6_cmd", 10)
        self.pub_gazebo_hand_left = self.create_publisher(
            Float64, "/joint_left_cmd", 10
        )
        self.pub_gazebo_hand_right = self.create_publisher(
            Float64, "/joint_right_cmd", 10
        )

    def current_position(self):
        msg = self.createPosJoint()
        if self.isPositionChanged(msg.position, epsilon=0.1):
            self.current_pos = msg.position
            self.pub_joint_states.publish(msg)
            self.get_logger().info('Publishing: "%s"' % msg.position)

    def createPosJoint(self):
        self.joint_position = self.m_bcapclient.robot_execute(self.HRobot, "CurJnt")[
            0:6
        ]
        self.joint_position.append(
            self.m_bcapclient.controller_execute(self.hCtrl, "HandCurPos")
        )
        msg = PosJoint()
        msg.position = self.joint_position
        return msg

    def isPositionChanged(self, new_joint_position, epsilon=sys.float_info.epsilon):
        for new_joint, old_joint in zip(new_joint_position, self.current_pos):
            if abs(new_joint - old_joint) > epsilon:
                return True
        return False

    def get_current_position_callback(self, request, response):
        response.position = self.m_bcapclient.robot_execute(self.HRobot, "CurJnt")[0:6]
        response.position.append(
            self.m_bcapclient.controller_execute(self.hCtrl, "HandCurPos")
        )
        return response

    def move_cobotta(
        self, j1=0, j2=0, j3=90, j4=0, j5=90, j6=0, hand=0, is_joints_abs="false"
    ):
        self.current_joints_states = self.m_bcapclient.robot_execute(
            self.HRobot, "CurJnt"
        )[0:6]
        self.current_joints_states.append(
            self.m_bcapclient.controller_execute(self.hCtrl, "HandCurPos")
        )
        self.m_bcapclient.robot_execute(self.HRobot, "TakeArm")
        self.m_bcapclient.robot_execute(self.HRobot, "Motor", [1, 0])
        self.m_bcapclient.robot_execute(self.HRobot, "ExtSpeed", 80)
        if is_joints_abs == "false":
            self.m_bcapclient.robot_move(
                self.HRobot,
                1,
                "@P J({},{},{},{},{},{})".format(
                    self.current_joints_states[0] + j1,
                    self.current_joints_states[1] + j2,
                    self.current_joints_states[2] + j3,
                    self.current_joints_states[3] + j4,
                    self.current_joints_states[4] + j5,
                    self.current_joints_states[5] + j6,
                ),
            )
            self.m_bcapclient.controller_execute(
                self.hCtrl, "HandMoveA", [self.current_joints_states[6] + hand, 100]
            )
        else:
            self.m_bcapclient.robot_move(
                self.HRobot, 1, "@P J({},{},{},{},{},{})".format(j1, j2, j3, j4, j5, j6)
            )
            self.m_bcapclient.controller_execute(self.hCtrl, "HandMoveA", [hand, 100])
        self.m_bcapclient.robot_execute(self.HRobot, "GiveArm")

    def move_joint_callback(self, joint_msg):
        self.movements = 1
        is_joints_abs = joint_msg.header.frame_id
        j1, j2, j3, j4, j5, j6, hand = joint_msg.position[:7]

        self.get_logger().info("Received")
        self.update_gazebo_pos_only(joint_msg)

    def update_gazebo_pos_only(self, joint_msg):
        j1, j2, j3, j4, j5, j6, hand = joint_msg.position[:7]
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

        for msg_j_var, publisher in zip(
            [msg_j1, msg_j2, msg_j3, msg_j4, msg_j5, msg_j6, msg_hand, msg_hand],
            [
                self.pub_gazebo_j1,
                self.pub_gazebo_j2,
                self.pub_gazebo_j3,
                self.pub_gazebo_j4,
                self.pub_gazebo_j5,
                self.pub_gazebo_j6,
                self.pub_gazebo_hand_left,
                self.pub_gazebo_hand_right,
            ],
        ):
            publisher.publish(msg_j_var)

    def update_gazebo_pos(self):
        msg_j = [Float64() for _ in range(7)]
        msg_j1, msg_j2, msg_j3, msg_j4, msg_j5, msg_j6, msg_hand = msg_j

        cur_joints = self.m_bcapclient.robot_execute(self.HRobot, "CurJnt")
        for i, msg_j_var in enumerate([msg_j1, msg_j2, msg_j3, msg_j4, msg_j5, msg_j6]):
            msg_j_var.data = convert_grad_to_rad(cur_joints[i])
        msg_hand.data = convert_hand_cobotta_gazebo(
            self.m_bcapclient.controller_execute(self.hCtrl, "HandCurPos")
        )

        for msg_j_var, publisher in zip(
            [msg_j1, msg_j2, msg_j3, msg_j4, msg_j5, msg_j6, msg_hand, msg_hand],
            [
                self.pub_gazebo_j1,
                self.pub_gazebo_j2,
                self.pub_gazebo_j3,
                self.pub_gazebo_j4,
                self.pub_gazebo_j5,
                self.pub_gazebo_j6,
                self.pub_gazebo_hand_left,
                self.pub_gazebo_hand_right,
            ],
        ):
            publisher.publish(msg_j_var)

    def play_trajectory_callback(self, request, response):
        self.movements = len(request.joints_position)
        for joint_state in request.joints_position:
            is_joints_abs = joint_state.header.frame_id
            j1, j2, j3, j4, j5, j6, hand = joint_state.position[:7]
            self.update_gazebo_pos()
            self.current_position()
        response.completed = True
        return response

    def update_cobotta_from_gazebo_callback(self, joint_msg):
        print(joint_msg.position)
        if self.movements > 0:
            self.movements -= 1
            return
        is_joints_abs = joint_msg.header.frame_id
        j1, j2, j3, j4, j5, j6, hand = joint_msg.position[:7]
        self.get_logger().info("Received")

def main(args=None):
    rclpy.init(args=args)

    joint_state_sub = HardwareControl()
    print("cobotta_node started")
    rclpy.spin(joint_state_sub)

    joint_state_sub.destroy_node()
    rclpy.shutdown()


if __name__ == "__main__":
    main()
