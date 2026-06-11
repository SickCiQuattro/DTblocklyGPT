# DTblocklyGPT: Cobotta Digital Twin Setup & Startup Guide

This document guides you through setting up and running the DTblocklyGPT project, with special considerations for developers using a Linux Virtual Machine (VM) accessed via SSH from a Windows host.

---

## 🛠️ Environment & Tech Stack
- **OS:** Ubuntu 24.04 (runs natively or in a VM/WSL)
- **Robotics Middleware:** ROS 2 Jazzy
- **Simulation:** Gazebo Harmonic
- **Backend:** Python / Django / Flask (via Poetry)
- **Frontend:** React / Vite / Blockly (via npm)

---

## 📋 First-Time Setup Instructions

Before running the application for the first time, you must configure the environment, install dependencies, compile the ROS2 packages, and initialize the database.

### 1. Environment Configurations (`.env`)
The environment configuration files are ignored by git. You must create them from their templates:
- **Backend Environment:**
  Copy `backend/.env.example` to `backend/.env` and configure your LLM provider and API key:
  ```bash
  cp backend/.env.example backend/.env
  ```
  Open `backend/.env` and insert your Gemini or OpenAI API keys:
  ```env
  LLM_PROVIDER = "gemini"
  LLM_MODEL = "gemini-3.1-flash-lite"
  GEMINI_API_KEY = "your_api_key_here"
  ```

- **Frontend Environment:**
  Copy `frontend/.env.example` to `frontend/.env`:
  ```bash
  cp frontend/.env.example frontend/.env
  ```
  For standard local or SSH-forwarded configurations, you can keep the default values (all pointing to `localhost`):
  ```env
  VITE_BACKEND_PROTOCOL = http://
  VITE_BACKEND_HOST = localhost
  VITE_BACKEND_PORT = :8000
  VITE_FRONTEND_PROTOCOL = http://
  VITE_FRONTEND_HOST = localhost
  VITE_FRONTEND_PORT = :3000
  ```

### 2. Database File
The database file `db.sqlite3` is committed to the repository. It contains all pre-configured mock users, robots, positions, and tasks. You do not need to run migrations or seed commands.


### 3. ROS2 Workspace Dependencies & Virtual Environment
To compile the ROS2 workspace (`ros2_ws`), you need system dependencies for C++ packages like `web_video_server` and `async_web_server_cpp`.
```bash
cd ~/DTblocklyGPT/ros2_ws

# 1. Update and install all ROS2 package dependencies using rosdep
sudo apt update
rosdep update
rosdep install --from-paths src --ignore-src -r -y

# 2. Create the Python virtual environment
# CRITICAL: You MUST use the --system-site-packages flag so the environment can access system ROS2 Python bindings (like rclpy)
virtualenv .venv --system-site-packages

# 3. Build the workspace
source /opt/ros/jazzy/setup.bash
source .venv/bin/activate
colcon build
```

---

## 🌐 VM & SSH Port Forwarding Guide (For Host Machine Users)

If you are running the project inside a Linux Virtual Machine (or remote server) and connecting via SSH from a Host Machine:
The easiest way to work on the project is to use **SSH Port Forwarding**. This maps the VM's ports to your Host Machine `localhost`, preventing CORS/CSRF trusted origins issues and network connection failures.

### How to connect using command line SSH:
When SSHing into the VM from Windows (Powershell or CMD), forward ports **3000** (Frontend), **8000** (Backend), **5000** (Flask ROS-Bridge), and **5001** (SocketIO Stream):
```bash
ssh -L 3000:localhost:3000 -L 8000:localhost:8000 -L 5000:localhost:5000 -L 5001:localhost:5001 user@your-vm-ip
```

### How to configure in VS Code (SSH Remote Extension):
If you use the VS Code "Remote - SSH" extension, VS Code automatically forwards ports. 
Ensure you check the **"Ports"** tab in the bottom panel and add/verify these forwards:
- `3000` (React frontend)
- `8000` (Django backend)
- `5000` (Flask bridge)
- `5001` (SocketIO stream)

Once forwarded, you can open your browser on Windows and go directly to `http://localhost:3000` to interact with the application.

---

## 🚦 Startup Guide

Launch the components in parallel using **3 separate terminal windows** inside the VM.
*Note: Ensure you run the commands in the specified order to prevent synchronization crashes.*

### Terminal 1 — The Backend (Django)
Manages the REST APIs, SQLite database, and OpenAI integrations.
```bash
cd ~/DTblocklyGPT
poetry run python manage.py runserver
```
*(Runs Django server on `http://localhost:8000`)*

### Terminal 2 — The Frontend (React/Vite)
The user interface featuring the Blockly visual workspace.
```bash
cd ~/DTblocklyGPT
npm start
```
*(Runs Vite dev server on `http://localhost:3000`)*

### Terminal 3 — The Gazebo Simulator & ROS2 Stack (Digital Twin)
Runs Gazebo, the ROS-Gazebo bridge, the HTTP REST API bridge, and all state/command nodes.
```bash
cd ~/DTblocklyGPT/ros2_ws/Cobotta
bash launch_sim.sh
```

> [!TIP]
> By default, `launch_sim.sh` runs Gazebo in **Headless mode** (recommended for testing & CPU saving).
> If you want to open the **Full 3D GUI**, edit `launch_sim.sh` and remove the `-s` flag from the `gz sim` command.