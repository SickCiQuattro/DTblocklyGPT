# Guida all'Avvio: DTblocklyGPT

Questa guida descrive la procedura esatta per avviare l'architettura full-stack del progetto su ambiente **Ubuntu 24.04 (ARM64 via UTM)** con **ROS 2 Jazzy** e **Gazebo Harmonic**.

Poiché si tratta di un sistema distribuito, è necessario avviare i vari componenti in parallelo utilizzando **5 terminali separati**. L'ordine di avvio è importante per evitare crash di sincronizzazione.

---

### 1. Il Backend (Django)
Gestisce le API, il database e l'integrazione con OpenAI.
```bash
cd ~/DTblocklyGPT
poetry run python manage.py runserver
```

### 2. Il Frontend (React/Vite)
L'interfaccia utente con i blocchi Blockly.
```bash
cd ~/DTblocklyGPT/frontend
npm start
```

### 3. Il Simulatore (Gazebo - Modalità Invisibile)
Calcola la fisica e la cinematica in background senza renderizzare la grafica 3D.
```bash
cd ~/DTblocklyGPT/ros2_ws/Cobotta
gz sim -s worldCobotta.sdf
```

### 3B. Il Simulatore (Gazebo - Modalità Grafica)
Calcola la fisica e la cinematica in background - eseguire da terminale Ubuntu
```bash
cd ~/DTblocklyGPT/ros2_ws/Cobotta
gz sim worldCobotta.sdf
```

### 4. Il Bridge (Traduttore ROS-Gazebo)
Mette in comunicazione i topic ROS 2 con i topic interni di Gazebo.
```bash
cd ~/DTblocklyGPT/ros2_ws
source install/setup.bash
ros2 run ros_gz_bridge parameter_bridge --ros-args -p config_file:=./Cobotta/map.yaml
```

### 5. Il Cervello Robotico (Nodo ROS 2)
Il controller che riceve le API dal backend e muove il robot.
```bash
cd ~/DTblocklyGPT/ros2_ws
source install/setup.bash
ros2 run cobotta_rest_api cobotta_node
```