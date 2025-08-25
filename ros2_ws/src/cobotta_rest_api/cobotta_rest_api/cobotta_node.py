import sys

import rclpy
from rclpy.node import Node

import math

from .orin.bcapclient import BCAPClient as bcapclient

from sensor_msgs.msg import JointState
from my_robot_interfaces.srv import PositionJoint
from my_robot_interfaces.srv import ListPosJoint
from my_robot_interfaces.msg import PosJoint
from std_msgs.msg import Float64



class HardwareControl(Node):
    joint_position = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    current_pos = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]

    def __init__(self):
        self.movements = 0
        # set IP Address , Port number and Timeout of connected RC8
        self.host = "192.168.0.1"
        self.port = 5007
        self.timeout = 2000

        # set Parameter
        self.Name = ""
        self.Provider = "CaoProv.DENSO.VRC"
        self.Machine = "localhost"
        self.Option = ""

        self.comp = 1
        self.loopflg = True
        self.ESC = 0x1B  # [ESC] virtual key code

        # Connection processing of tcp communication
        self.m_bcapclient = bcapclient(self.host, self.port, self.timeout)
        # start b_cap Service
        self.m_bcapclient.service_start("")

        # Connect to RC8 (RC8(VRC)provider)
        self.hCtrl = self.m_bcapclient.controller_connect(
            self.Name, self.Provider, self.Machine, self.Option
        )

        self.HRobot = self.m_bcapclient.controller_getrobot(self.hCtrl, "Arm", "")

        super().__init__("cobotta_node")
        self.sub_joint_states = self.create_subscription(
            JointState, "/move_joint", self.move_joint_callback, 10
        )

        self.play_trajectory_service = self.create_service(ListPosJoint, '/play_trajectory',
                                                           self.play_trajectory_callback)

        self.pub_joint_states = self.create_publisher(PosJoint, '/actual_joint_position', 10)
        timer_period = 0.5
        self.timer = self.create_timer(timer_period, self.current_position)

        self.current_joints_service = self.create_service(PositionJoint, '/get_position_joints',
                                                          self.get_current_position_callback)

        self.sub_gazebo_joint_states = self.create_subscription(
            JointState, "/gazebo_position", self.update_cobotta_from_gazebo_callback, 10
        )

        self.pub_gazebo_j1 = self.create_publisher(Float64, '/joint1_cmd',10)
        self.pub_gazebo_j2 = self.create_publisher(Float64, '/joint2_cmd', 10)
        self.pub_gazebo_j3 = self.create_publisher(Float64, '/joint3_cmd', 10)
        self.pub_gazebo_j4 = self.create_publisher(Float64, '/joint4_cmd', 10)
        self.pub_gazebo_j5 = self.create_publisher(Float64, '/joint5_cmd', 10)
        self.pub_gazebo_j6 = self.create_publisher(Float64, '/joint6_cmd', 10)
        self.pub_gazebo_hand_left = self.create_publisher(Float64, '/joint_left_cmd', 10)
        self.pub_gazebo_hand_right = self.create_publisher(Float64, '/joint_right_cmd', 10)

    def current_position(self):
        msg = self.createPosJoint()
        if self.isPositionChanged(msg.position, epsilon=0.1):
            self.current_pos = msg.position
            self.pub_joint_states.publish(msg)
            self.get_logger().info('Publishing: "%s"' % msg.position)

    def createPosJoint(self):
        self.joint_position = self.m_bcapclient.robot_execute(self.HRobot, 'CurJnt')[0:6]
        self.joint_position.append(self.m_bcapclient.controller_execute(self.hCtrl, "HandCurPos"))
        msg = PosJoint()
        msg.position = self.joint_position
        return msg
    def isPositionChanged(self, new_joint_position, epsilon=sys.float_info.epsilon):
        for new_joint,old_joint in zip(new_joint_position, self.current_pos):
            if abs(new_joint - old_joint) > epsilon:
                return True
        return False

    def get_current_position_callback(self, request, response):
        response.position = self.m_bcapclient.robot_execute(self.HRobot, 'CurJnt')[0:6]
        response.position.append(self.m_bcapclient.controller_execute(self.hCtrl, "HandCurPos"))
        return response

    def move_cobotta(self, j1=0, j2=0, j3=90, j4=0, j5=90, j6=0, hand=0, is_joints_abs="false"):
        self.current_joints_states = self.m_bcapclient.robot_execute(self.HRobot, 'CurJnt')[0:6]
        self.current_joints_states.append(self.m_bcapclient.controller_execute(self.hCtrl, "HandCurPos"))
        self.m_bcapclient.robot_execute(self.HRobot, "TakeArm")
        self.m_bcapclient.robot_execute(self.HRobot, "Motor", [1, 0])
        self.m_bcapclient.robot_execute(self.HRobot, "ExtSpeed", 80)
        if is_joints_abs == "false":
            self.m_bcapclient.robot_move(
                  self.HRobot, 1, "@P J({},{},{},{},{},{})".format(self.current_joints_states[0]+j1,
                                                                       self.current_joints_states[1]+j2,
                                                                       self.current_joints_states[2]+j3,
                                                                       self.current_joints_states[3]+j4,
                                                                       self.current_joints_states[4]+j5,
                                                                       self.current_joints_states[5]+j6 )
            )
            self.m_bcapclient.controller_execute(self.hCtrl, "HandMoveA", [self.current_joints_states[6] + hand,100])
        else:
            self.m_bcapclient.robot_move(
                self.HRobot, 1, "@P J({},{},{},{},{},{})".format(j1,j2,j3,j4,j5,j6)
            )
            self.m_bcapclient.controller_execute(self.hCtrl, "HandMoveA", [hand, 100])
        self.m_bcapclient.robot_execute(self.HRobot, "GiveArm")


    def move_joint_callback(self, joint_msg):
        self.movements = 1
        is_joints_abs = joint_msg.header.frame_id
        j1, j2, j3, j4, j5, j6, hand = joint_msg.position[:7]

        self.get_logger().info('Received')
        self.move_cobotta(j1, j2, j3, j4, j5, j6, hand, is_joints_abs)

        self.update_gazebo_pos()

    def convert_hand_cobotta_gazebo(self, num):
        return num / 2000 - 0.015
    def update_gazebo_pos(self):
        msg_j = [Float64() for _ in range(7)]
        msg_j1, msg_j2, msg_j3, msg_j4, msg_j5, msg_j6, msg_hand = msg_j

        cur_joints = self.m_bcapclient.robot_execute(self.HRobot, 'CurJnt')
        for i, msg_j_var in enumerate([msg_j1, msg_j2, msg_j3, msg_j4, msg_j5, msg_j6]):
            msg_j_var.data = self.convert_grad_to_rad(cur_joints[i])
        msg_hand.data = self.convert_hand_cobotta_gazebo(self.m_bcapclient.controller_execute(self.hCtrl, "HandCurPos"))

        for msg_j_var, publisher in zip([msg_j1, msg_j2, msg_j3, msg_j4, msg_j5, msg_j6, msg_hand, msg_hand],
                                        [self.pub_gazebo_j1, self.pub_gazebo_j2, self.pub_gazebo_j3, self.pub_gazebo_j4,
                                         self.pub_gazebo_j5, self.pub_gazebo_j6, self.pub_gazebo_hand_left, self.pub_gazebo_hand_right]):
            publisher.publish(msg_j_var)

    def play_trajectory_callback(self, request, response):
        self.movements = len(request.joints_position)
        for joint_state in request.joints_position:
            is_joints_abs = joint_state.header.frame_id
            j1, j2, j3, j4, j5, j6, hand = joint_state.position[:7]
            self.move_cobotta(j1, j2, j3, j4, j5, j6, hand, is_joints_abs)
            self.update_gazebo_pos()
            self.current_position()
        response.completed = True
        return response

    def convert_grad_to_rad(self, num):
        return num * (math.pi / 180)

    def convert_hand_gazebo_cobotta(self, num):
        return (num + 0.015) * 2000

    def update_cobotta_from_gazebo_callback(self, joint_msg):
        print(joint_msg.position)
        if self.movements > 0:
            self.movements -= 1
            return
        is_joints_abs = joint_msg.header.frame_id
        j1, j2, j3, j4, j5, j6, hand = joint_msg.position[:7]
        self.get_logger().info('Received')
        self.move_cobotta(j1, j2, j3, j4, j5, j6, self.convert_hand_gazebo_cobotta(hand), is_joints_abs)




def main(args=None):
    rclpy.init(args=args)

    joint_state_sub = HardwareControl()

    rclpy.spin(joint_state_sub)

    joint_state_sub.destroy_node()
    rclpy.shutdown()


if __name__ == "__main__":
    main()


