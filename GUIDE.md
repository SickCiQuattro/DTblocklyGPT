# DTblocklyGPT: Cobotta Digital Twin

## 🛠️ Environment & Tech Stack
- **OS:** Ubuntu 24.04 (Optimized for ARM64 via UTM on Apple Silicon)
- **Robotics Middleware:** ROS 2 Jazzy
- **Simulation:** Gazebo Harmonic
- **Backend:** Python / Django / Flask
- **Frontend:** React / Vite / Blockly

## 🚦 Startup Guide

Because this is a distributed system, you need to launch the components in parallel using **3 separate terminal windows**.
*Note: Ensure you run the commands in the specified order to prevent synchronization crashes.*

### 1. The Backend (Django)
Manages the REST APIs, SQLite database, and OpenAI integrations.
```bash
cd ~/DTblocklyGPT
poetry run python manage.py runserver
```

### 2. The Frontend (React/Vite)
The user interface featuring the Blockly visual workspace.
```bash
cd ~/DTblocklyGPT/frontend
npm start
```
*(Access the app at `http://localhost:3000`)*

### 3. The Gazebo Simulator & ROS2 Stack (Digital Twin)
Runs Gazebo, the ROS-Gazebo bridge, the HTTP REST API bridge, and all state/command nodes.
```bash
cd ~/DTblocklyGPT/ros2_ws/Cobotta
bash launch_sim.sh
```

> [!TIP]
> By default, `launch_sim.sh` runs Gazebo in **Headless mode** (recommended for testing & CPU saving).
> If you want to open the **Full 3D GUI**, edit `launch_sim.sh` and remove the `-s` flag from the `gz sim` command.