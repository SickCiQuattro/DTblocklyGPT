#./usr/bin/env python3
"""
Test fisica Cobotta - Gazebo Harmonic + ROS2 Jazzy

PREREQUISITI:
- avvia gazebo_bridge.bat
- avvia worldCobotta.sdf
"""

import rclpy
from rclpy.node import Node
from std_msgs.msg import Float64
import time

# todo: aggiugnere spawn automatico degli oggetti e location necessarie per il testing
# * inizialmente si caricavano direttamente con il mondo worldCobotta.sdf, e venivano inclusi come dei moduli statici
# * inserirli all'avvio del test di pick and place con funzione di reset della scena (guarda simulate.py)

# <include>
#       <name>flaskholder1</name>
#       <static>false</static>
#       <pose>-9.05 -1.48 1.065 0 0 0</pose>
#       <uri>
#         model://locations/flask_holder/model.sdf
#       </uri>
#     </include>

#     <include>
#       <name>flaskholder2</name>
#       <static>false</static>
#       <pose>-8.8 -1.41 1.065 0 0 0</pose>
#       <uri>
#         model://locations/flask_holder/model.sdf
#       </uri>
#     </include>

#     <include>
#       <name>flask</name>
#       <static>false</static>
#       <pose>-9.05 -1.48 1.065 0 0 0</pose>
#       <uri>
#         model://objects/flask/model.sdf
#       </uri>
#     </include>

class CobottaControllerROS2(Node):
    
    def __init__(self):
        super().__init__('cobotta_test_controller')
        
        # Topic ROS2 mappati da ros_gz_bridge tramite map.yaml
        # Il bridge mappa i topic Gazebo a nomi ROS2 più semplici
        self.joint_topics = {
            'joint1': '/joint1_cmd',
            'joint2': '/joint2_cmd',
            'joint3': '/joint3_cmd',
            'joint4': '/joint4_cmd',
            'joint5': '/joint5_cmd',
            'joint6': '/joint6_cmd',
            'gripper_left': '/joint_left_cmd',
            'gripper_right': '/joint_right_cmd',
        }
        
        # publishers
        self.joint_publishers = {}
        for joint_name, topic in self.joint_topics.items():
            pub = self.create_publisher(Float64, topic, 10)
            self.joint_publishers[joint_name] = pub
            self.get_logger().info(f' Publisher creato per {joint_name}')
        
        time.sleep(1.0)
        self.get_logger().info('\n' + '='*60)
        self.get_logger().info('Controller Cobotta ROS2 inizializzato.')
        self.get_logger().info('='*60 + '\n')

    def set_joint_position(self, joint_name, position):
        if joint_name not in self.joint_publishers:
            self.get_logger().error(f"Joint '{joint_name}' non trovato.")
            return False
        
        msg = Float64()
        msg.data = float(position)
        self.joint_publishers[joint_name].publish(msg)
        return True

    def move_joints(self, positions, duration=2.0, verify=False, tolerance=0.01):
        self.get_logger().info(f"Movimento joints: {positions}")
        
        for joint_name, position in positions.items():
            self.set_joint_position(joint_name, position)
        
        time.sleep(duration)
        
        if verify:
            self.get_logger().info("Verifica posizioni raggiunte...")
            time.sleep(0.5)  

    def home_position(self):
        print("\n Posizione HOME")
        self.move_joints({
            'joint1': 0.0,
            'joint2': 0.0,
            'joint3': 1.50,
            'joint4': 0.0,
            'joint5': 0.0,
            'joint6': 0.0
        }, duration=3.0)

    def open_gripper(self):
        print("\n Apertura gripper")
        self.move_joints({
            'gripper_left': 0.0,
            'gripper_right': 0.0
        }, duration=3.0)

    def close_gripper(self):
        print("\n Chiusura gripper")
        self.move_joints({
            'gripper_left': -0.015,
            'gripper_right': -0.015
        }, duration=3.0)

    def test_collision_with_table(self):
        print("\n" + "="*60)
        print("TEST 1: Verifica Collisioni con il Tavolo")
        print("="*60)
        
        self.home_position()
        
        print("\n Abbassamento verso il tavolo...")
        positions_test = [
            ({'joint2': 0.6, 'joint3': 1.2}, "Posizione 1"),
            ({'joint2': 1.0, 'joint3': 1.3, 'joint5': 0.3}, "Posizione 2"),
            ({'joint2': 1.3, 'joint3': 1.8, 'joint5': 0.6}, "Posizione 3"),
        ]
        
        for pos, desc in positions_test:
            print(f"\n  → {desc}")
            self.move_joints(pos, duration=2.5)
            input("  Premi INVIO per continuare...")
        
        print("\n Test collisioni completato.")
        print("  Verifica: il robot dovrebbe fermarsi sul tavolo senza attraversarlo")

    def test_gripper_functionality(self):
        print("\n" + "="*60)
        print("TEST 2: Funzionalità Gripper")
        print("="*60)
        
        self.home_position()
        
        print("\n Test apertura/chiusura gripper...")
        for i in range(3):
            print(f"\n  Ciclo {i+1}/3")
            self.open_gripper()
            time.sleep(0.5)
            self.close_gripper()
            time.sleep(0.5)
        
        self.open_gripper()
        print("\n Test gripper completato.")

    def test_pick_and_place_simulation(self):
        print("\n" + "="*60)
        print("TEST 3: Simulazione Pick and Place")
        print("="*60)
        print("\nOBIETTIVO: Afferrare il cubo rosso a Y=-1.5, sollevarlo e spostarlo")
        print("Posizione robot: Y=-1.2, Posizione cubo: Y=-1.5 (distanza 30cm)")
        
        self.home_position()
        self.open_gripper()
        
        print("\nFase 1: Avvicinamento all'oggetto (cubo rosso)")
        print("   Estensione braccio in avanti...")
        self.move_joints({
            'joint1': 0.0,
            'joint2': 0.8,     
            'joint3': 1.4,
            'joint4': 0.0,      
            'joint5': 0.0,
            'joint6': 0.0
        }, duration=3.0)
        time.sleep(2.0)
        
        print("\nFase 2: Discesa precisa verso l'oggetto")
        print("   Abbassamento lento per allinearsi al cubo...")
        self.move_joints({
            'joint1': 0.0,
            'joint2': 0.9,     
            'joint3': 1.65,
            'joint4': 0.0,      
            'joint5': 0.0,
            'joint6': 0.0
        }, duration=3.0)
        time.sleep(1.0)
        
        input("\nIl gripper dovrebbe circondare il cubo. Premi INVIO per afferrare...")
        
        print("\nFase 3: Presa dell'oggetto")
        self.close_gripper()
        time.sleep(2.0)
        
        input("\nOggetto afferrato. Premi INVIO per sollevare...")
        
        print("\nFase 4: Sollevamento con oggetto")
        print("   Sollevamento graduale...")
        self.move_joints({
            'joint2': 0.35,     
            'joint3': 1.2,     
            'joint5': 0.4      
        }, duration=3.5)
        time.sleep(1.0)
        
        input("\nOggetto sollevato. Premi INVIO per spostare...")
        
        print("\nFase 5: Spostamento laterale")
        print("   Rotazione base per depositare in nuova posizione...")
        self.move_joints({
            'joint1': 0.9,    
        }, duration=2.5)
        time.sleep(1.0)
        
        input("\nPosizione raggiunta. Premi INVIO per depositare...")
        
        print("\nFase 6: Abbassamento per rilascio")
        print("   Avvicinamento al tavolo nella nuova posizione...")
        self.move_joints({
            'joint2': 0.5,      
            'joint3': 1.52,      
            'joint5': 0.85     
        }, duration=2.0)
        time.sleep(1.0)
        self.move_joints({
            'joint2': 0.93,      
            'joint3': 1.40,      
            'joint5': 0.35     
        }, duration=2.0)
        time.sleep(1.0)
        
        input("\nPronto per rilascio. Premi INVIO...")
        
        print("\nFase 7: Rilascio dell'oggetto")
        self.open_gripper()
        time.sleep(2.0)
        
        print("\nFase 8: Ritiro dal punto di rilascio")
        self.move_joints({
            'joint2': 0.3,
            'joint3': 1.3,
            'joint5': 0.3
        }, duration=2.0)
        
        print("\nRitorno alla posizione HOME")
        self.home_position()
        
        print("\nTest pick and place completato.")

    def test_joint_stability(self):
        """Test 4: Verifica stabilità joints"""
        print("\n" + "="*60)
        print("TEST 4: Stabilità dei Joint")
        print("="*60)

        self.test_one_joint('joint1')
        self.test_one_joint('joint2')
        self.test_one_joint('joint3')
        self.test_one_joint('joint4')
        self.test_one_joint('joint5')
        self.test_one_joint('joint6')

        print("\n Test stabilità completato.")

    def test_one_joint(self, joint_name):
        self.home_position()
        
        print(f"\n Test di stabilità: muovo {joint_name} e osservo gli altri joint...")
        
        print(f"\n  → Movimento {joint_name} a 0.5 rad")
        self.move_joints({joint_name: 0.5}, duration=2.0)
        
        print("\n  Attesa 5 secondi - osserva se ci sono oscillazioni...")
        time.sleep(5.0)

        print(f"\n  → Movimento {joint_name} a -0.5 rad")
        self.move_joints({joint_name: -0.5}, duration=2.0)

        print("\n  Attesa 5 secondi - osserva se ci sono oscillazioni...")
        time.sleep(5.0)
        
        self.home_position()

    def run_all_tests(self):
        print("\n" + "="*60)
        print("AVVIO SUITE COMPLETA DI TEST")
        print("="*60)
        
        tests = [
            ("Collisioni con tavolo", self.test_collision_with_table),
            ("Funzionalità Gripper", self.test_gripper_functionality),
            ("Stabilità Joint", self.test_joint_stability),
            ("Pick and Place Completo", self.test_pick_and_place_simulation),
        ]
        
        for i, (name, test_func) in enumerate(tests, 1):
            print(f"\n\n{'='*60}")
            print(f"Test {i}/{len(tests)}: {name}")
            print(f"{'='*60}")
            
            try:
                test_func()
                print(f"\n{name} - COMPLETATO")
            except Exception as e:
                self.get_logger().error(f"\n{name} - ERRORE: {e}")
            
            if i < len(tests):
                input(f"\nPronto per il test successivo? Premi INVIO...")
        
        print("\n" + "="*60)
        print("TUTTI I TEST COMPLETATI.")
        print("="*60)


def main(args=None):
    """Funzione principale"""
    print("""
╔═══════════════════════════════════════════════════════════╗
║         TEST - COBOTTA PICK AND PLACE (ROS2)              ║
║                                                           ║
║  Obiettivi da testare:                                    ║
║  1. Collisioni robot-tavolo                               ║
║  2. Funzionalita' gripper                                 ║
║  3. Stabilita' dei joint                                  ║
║  4. Operazione completa di pick and place                 ║
║                                                           ║
║  PREREQUISITI:                                            ║
║  - ROS2 Jazzy                                             ║
║  - Gazebo Harmonic in esecuzione                          ║
║  - ros_gz_bridge attivo                                   ║
║  - World worldCobotta.sdf caricato                        ║
╚═══════════════════════════════════════════════════════════╝
    """)
    input("Premi INVIO per continuare...")
    
    rclpy.init(args=args)
    
    try:
        controller = CobottaControllerROS2()
        
        # Menu interattivo
        while rclpy.ok():
            print("\n" + "="*60)
            print("MENU TEST")
            print("="*60)
            print("1. Test Collisioni con Tavolo")
            print("2. Test Funzionalità Gripper")
            print("3. Test Stabilità Joint")
            print("4. Test Pick and Place Completo")
            print("5. Esegui TUTTI i test")
            print("6. Posizione Home")
            print("0. Esci")
            print("="*60)
            
            choice = input("\nScegli un'opzione (0-6): ").strip()
            
            if choice == '1':
                controller.test_collision_with_table()
            elif choice == '2':
                controller.test_gripper_functionality()
            elif choice == '3':
                controller.test_joint_stability()
            elif choice == '4':
                controller.test_pick_and_place_simulation()
            elif choice == '5':
                controller.run_all_tests()
            elif choice == '6':
                controller.home_position()
            elif choice == '0':
                print("\nUscita dal programma...")
                break
            else:
                print("\nOpzione non valida.")
        
        controller.destroy_node()
        rclpy.shutdown()
        
    except KeyboardInterrupt:
        print("\n\n  Interruzione da tastiera.")
    except Exception as e:
        print(f"\n Errore: {e}")
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    main()