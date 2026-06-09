import rclpy
from rclpy.node import Node
from sensor_msgs.msg import JointState
from .cobotta_utils import convert_rad_to_grad

class BridgeNodeROS(Node):
    def __init__(self):
        super().__init__("bridge_node_ros")
        
        # Publisher per inviare comandi di movimento a gazebo_command_node o cobotta_node
        self.publisher = self.create_publisher(JointState, "/move_joint", 10)
        
        # Subscriber per ricevere la posizione corrente da Gazebo
        self.subscriber = self.create_subscription(
            JointState, "/joint_states", self.position_callback, 10
        )
        
        # Dizionario per memorizzare l'ultima posizione ricevuta
        # Usiamo nomi costanti (joint1, joint2...) invece di joint_1 per uniformità con SDF
        self.current_position = {
            'joint1': 0.0,
            'joint2': 0.0,
            'joint3': 0.0,
            'joint4': 0.0,
            'joint5': 0.0,
            'joint6': 0.0,
            'joint_left': 0.0,
            'joint_right': 0.0
        }
        
        self.get_logger().info("BridgeNodeROS initialized - listening to /joint_states")

    def position_callback(self, msg):
        """Callback che aggiorna la posizione corrente quando riceve dati da Gazebo."""
        if len(msg.name) == len(msg.position):
            # Converti in gradi dato che flask restituisce l'actual joint pos in gradi. Wait.
            # Convertire o no? Il dizionario viene letto da getActualJointsPos in flask_api
            # La funzione sendRequestPosition() in origine chiamava il robot fisico che rispondeva in gradi
            # Convertiamolo in gradi qui per avere coerenza.
            pos_dict = {}
            for name, pos in zip(msg.name, msg.position):
                # La posizione in Gazebo è in radianti (tranne gripper). Per i giunti rotazionali, passiamo a gradi.
                # Per joint_left/joint_right teniamo il valore raw gazebo.
                if name.startswith('joint_'):
                    pos_dict[name] = pos
                else:
                    pos_dict[name] = convert_rad_to_grad(pos)
            
            self.current_position.update(pos_dict)
            self.get_logger().debug(f'Position updated: {self.current_position}')
        else:
            self.get_logger().warning(f'Mismatch: {len(msg.name)} names vs {len(msg.position)} positions')

    def send_request_position(self):
        """Metodo per ottenere la posizione corrente del robot come dizionario."""
        return self.current_position

    def publish_joint_state(self, joint_state):
        """Metodo per pubblicare uno stato dei giunti."""
        self.publisher.publish(joint_state)
        self.get_logger().info('Publishing: "%s"' % joint_state.position)
