import math
import sys

import rclpy
from rclpy.node import Node

from sensor_msgs.msg import JointState
from .cobotta_utils import convert_rad_to_grad


class GazeboStateNode(Node):
    joint_position = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    current_pos = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]

    def __init__(self):
        super().__init__("gazebo_state_node")
        # Subscription al topic unificato /joint_states da Gazebo
        self.subscriber_gazebo = self.create_subscription(
            JointState, "/joint_states", self.get_joint_states_gazebo, 10
        )
        self.publisher = self.create_publisher(JointState, '/gazebo_position', 10)
        timer_period = 0.5  # Pubblica a 2 Hz come in gazebo_node originario
        self.timer = self.create_timer(timer_period, self.publish_current_pos)

    def get_joint_states_gazebo(self, msg):
        """
        Riceve il messaggio JointState unificato da Gazebo con tutti i joint.
        Il messaggio contiene: joint1, joint2, joint3, joint4, joint5, joint6, joint_left, joint_right
        """
        
        # Mappa i nomi dei joint agli indici nel nostro array
        joint_name_to_index = {
            'joint1': 0,
            'joint2': 1,
            'joint3': 2,
            'joint4': 3,
            'joint5': 4,
            'joint6': 5,
            'joint_left': 6
        }
        
        # Estrai le posizioni dal messaggio (e convertile in gradi)
        for i, name in enumerate(msg.name):
            if name in joint_name_to_index:
                idx = joint_name_to_index[name]
                # Gazebo usa radianti, qui convertiamo in gradi come richiede l'interfaccia verso polling_socket_node
                self.joint_position[idx] = convert_rad_to_grad(msg.position[i])
        
        self.get_logger().debug(f'Joint states received: {self.joint_position}')

    def createJointState(self):
        joint_state = JointState()
        joint_state.header.stamp = self.get_clock().now().to_msg()
        joint_state.header.frame_id = "true"
        joint_state.name = [f'joint_{i}' for i in range(1, 7)]
        joint_state.name.append('hand')
        joint_state.position = self.joint_position[0:7]
        joint_state.velocity = []
        joint_state.effort = []
        return joint_state

    def publish_current_pos(self):
        msg = self.createJointState()
        
        # Pubblica sempre per garantire continuità
        self.current_pos = list(msg.position)
        self.publisher.publish(msg)
        
        if self.isPositionChanged(msg.position, epsilon=0.1, epsilon_hand=0.001):
            self.get_logger().info('Publishing: "%s"' % self.current_pos)

    def isPositionChanged(self, new_joint_position, epsilon=sys.float_info.epsilon,
                          epsilon_hand=sys.float_info.epsilon):
        for new_joint, old_joint in zip(new_joint_position[:6], self.current_pos[:6]):
            if abs(new_joint - old_joint) > epsilon:
                return True
        if abs(new_joint_position[6] - self.current_pos[6]) > epsilon_hand:
            return True
        return False


def main(args=None):
    rclpy.init(args=args)

    joint_state_sub = GazeboStateNode()
    print("gazebo_state_node started")
    rclpy.spin(joint_state_sub)

    joint_state_sub.destroy_node()
    rclpy.shutdown()


if __name__ == "__main__":
    main()
