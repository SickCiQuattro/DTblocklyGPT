# :robot: DTblocklyGPT

This repository contains the prototype implementation of the project described in the [paper](https://dl.acm.org/doi/abs/10.1145/3610978.3640653).

> Gargioni, Luigi and Fogli, Daniela.
> "Integrating ChatGPT with Blockly for End-User Development of Robot Tasks"
> *Companion of the 2024 ACM/IEEE International Conference on Human-Robot Interaction*, pages 478–482, 2024.
> Publisher: ACM New York, NY.

## Citation

```bibtex
@inproceedings{gargioni2024integrating,
  title={Integrating ChatGPT with Blockly for End-User Development of Robot Tasks},
  author={Gargioni, Luigi and Fogli, Daniela},
  booktitle={Companion of the 2024 ACM/IEEE International Conference on Human-Robot Interaction},
  pages={478--482},
  year={2024}
}
```

---

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Platform Setup](#platform-setup)
- [Common Setup (run once)](#common-setup-run-once)
- [Run Procedure](#run-procedure)
- [Credentials & Ports](#credentials--ports)
- [Troubleshooting](#troubleshooting)

---

## Architecture

The system is composed of four independent processes that must all be running for full functionality:

| Process | Port | Role |
|---|---|---|
| Django backend | `:8000` | REST API, SQLite DB, AI/CV processing, IK solver |
| Vite frontend | `:3000` | React + Blockly UI |
| Flask ROS bridge | `:5000` | HTTP → ROS2 adapter (runs inside the ROS2 environment) |
| Gazebo + ROS2 | — | 3D simulation and robot state management |

> **Two Python environments coexist — never mix them.**
> `pyproject.toml` / Poetry env → Django, IK (`ikpy`), vision (`ultralytics`, `hand-gesture-engine`, `mediapipe`).
> `ros2_ws/.venv` → Flask bridge and ROS2 nodes only (system site-packages + `flask`, `flask-socketio`).
> Running `ros2` commands inside the Poetry shell, or running `poetry run` inside the `.venv`, will break things.

---

## Prerequisites

### Required software

- **Ubuntu 24.04** (Noble) — native install or WSL2 / Virtual Machine
- **ROS2 Jazzy** — [official install guide](https://docs.ros.org/en/jazzy/Installation/Ubuntu-Install-Debs.html)
- **Gazebo Harmonic** — [official install guide](https://gazebosim.org/docs/harmonic/install_ubuntu/)
- **Poetry** — [official install guide](https://python-poetry.org/docs/#installation)
- **Node.js 20.19+** (or 22 LTS) with npm — Vite 8 requires Node `≥20.19` / `≥22.12`; older 20.x fails

### System apt packages

Install all required system packages in one shot:

```bash
sudo apt update && sudo apt install -y \
    ros-jazzy-ros-gz \
    python3-colcon-common-extensions \
    python3-rosdep \
    python3-virtualenv \
    curl \
    psmisc \
    build-essential \
    cmake \
    libboost-dev \
    libboost-filesystem-dev \
    libboost-thread-dev \
    libopencv-dev \
    libasio-dev
```

> `ros-jazzy-ros-gz` provides the `ros_gz_bridge` used by `launch_sim.sh`.
> The `build-essential`/`cmake`/`boost`/`libasio` packages are required to compile the C++ streaming packages in `ros2_ws/src/`.

Initialize rosdep (once per machine):

```bash
sudo rosdep init   # skip if already done; error "already initialized" is safe to ignore
rosdep update
```

---

## Platform Setup

Choose your environment. Everything after this section is identical for both paths.

> **macOS / Windows-without-WSL2:** there is no native ROS2 Jazzy / Gazebo Harmonic build for macOS. Run **Ubuntu 24.04 in a VM** (UTM / Parallels / VMware) and follow **Path B**. On Apple Silicon use an **ARM64** Ubuntu image; Gazebo runs headless fine, but the 3D GUI is CPU-rendered and slow — keep it headless. Windows users who can't use WSL2 can likewise use a Linux VM + Path B.

<details>
<summary><strong> Path A — Windows + WSL2</strong></summary>

### Install WSL2 and Ubuntu 24.04

Open **PowerShell as Administrator** and run:

```powershell
wsl --install -d Ubuntu-24.04
wsl --set-default Ubuntu-24.04
```

Restart when prompted. After restart, open the Ubuntu terminal from the Start menu and complete the user setup.

### Access the app from Windows

All four processes run **inside WSL**. Your Windows browser connects via `localhost` automatically because WSL2 maps ports to the Windows host.

Open `http://localhost:3000` in any Windows browser after starting the frontend.

### VS Code (recommended)

Install the **WSL** extension, then open VS Code from inside the WSL terminal:

```bash
code .
```

All terminals in VS Code will run inside WSL automatically.

Now follow the [Common Setup](#common-setup-run-once) steps inside the WSL terminal.

</details>

<details>
<summary><strong> Path B — Virtual Machine / Native Linux</strong></summary>

### SSH port forwarding (if accessing from a host machine)

If you work from Windows/macOS and connect to the VM via SSH, forward all required ports so your local browser can reach the app:

```bash
ssh -L 3000:localhost:3000 \
    -L 8000:localhost:8000 \
    -L 5000:localhost:5000 \
    -L 5001:localhost:5001 \
    your_user@your-vm-ip
```

Keep this SSH session open while working.

### VS Code Remote-SSH (alternative to manual forwarding)

If you use the **Remote – SSH** VS Code extension, it forwards ports automatically. Check the **Ports** tab in the bottom panel and verify these are forwarded:

| Port | Service |
|---|---|
| `3000` | React frontend |
| `8000` | Django backend |
| `5000` | Flask ROS bridge |
| `5001` | SocketIO stream |

Once forwarded, open `http://localhost:3000` in your local browser.

Now follow the [Common Setup](#common-setup-run-once) steps inside the VM terminal (via SSH or directly).

</details>

---

## Common Setup (run once)

All commands run from the project root (`DTblocklyGPT/`) unless noted.

### 1. Clone the repository

```bash
git clone https://github.com/luigigargioni/DTblocklyGPT.git
cd DTblocklyGPT
```

### 2. Clone the ROS2 streaming packages

These two packages are required by `launch_sim.sh` for camera streaming. They are **not** bundled in this repository and must be cloned separately:

```bash
cd ros2_ws/src
git clone https://github.com/fkie/async_web_server_cpp.git
git clone https://github.com/RobotWebTools/web_video_server.git
cd ../..
```

### 3. Configure environment files

**Backend** — copy the template and add your LLM API key:

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` and fill in your key:

```env
FLASK_BRIDGE_URL = "http://localhost:5000"

LLM_PROVIDER = "gemini"
LLM_MODEL = "gemini-3.1-flash-lite"

OPENAI_API_KEY = ""
GEMINI_API_KEY = "your_key_here"
```

> `LLM_MODEL` must be a model your `GEMINI_API_KEY` can actually access — an invalid name makes every chat call fail. Switch provider with `LLM_PROVIDER` (`gemini` / `openai` / `ollama`); the matching endpoint is selected automatically (no `LLM_BASE_URL` needed for Gemini/OpenAI). If `LLM_MODEL` is left unset, the code falls back to `gemini-2.5-flash`.

**Frontend** — copy the template and fill in the localhost defaults:

```bash
cp frontend/.env.example frontend/.env
```

Open `frontend/.env` and set all six values:

```env
VITE_BACKEND_PROTOCOL = http://
VITE_BACKEND_HOST = localhost
VITE_BACKEND_PORT = :8000
VITE_FRONTEND_PROTOCOL = http://
VITE_FRONTEND_HOST = localhost
VITE_FRONTEND_PORT = :3000
```

> The template ships with empty strings (`''`). The app will not start correctly without these values.

### 4. Install backend dependencies (Poetry)

From the project root:

```bash
poetry install
```

This installs Django, `ikpy`, `ultralytics`, `mediapipe`, `hand-gesture-engine`, and all other backend dependencies into the Poetry virtual environment. This is the only environment where `ikpy` and the vision packages are available.

### 5. Install frontend dependencies (npm)

```bash
npm install --legacy-peer-deps
```

> The `--legacy-peer-deps` flag is required due to ESLint/React peer dependency conflicts.

### 6. Download the gesture recognition model

The `hand-gesture-engine` package requires a MediaPipe model file that is not bundled with the wheel. Download it once:

```bash
mkdir -p backend/assets
curl -L "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task" \
     -o backend/assets/hand_landmarker.task
```

The backend will automatically copy this file into the package on first use. Without it, every call to `/api/vision/frame/` will flood the logs with 500 errors.

> `yolov8n.pt` (object detection model) is downloaded automatically by `ultralytics` on first inference. Network access is required on the first run.

### 7. Build the ROS2 workspace

Navigate to `ros2_ws/`:

```bash
cd ros2_ws
```

Install ROS2 package dependencies (C++ packages need system libs):

```bash
source /opt/ros/jazzy/setup.bash
rosdep install --from-paths src --ignore-src -r -y
```

Create the Python virtual environment for ROS2 nodes:

```bash
virtualenv .venv --system-site-packages
source .venv/bin/activate
```

Install Flask inside this environment (used by `flask_node`):

```bash
pip install Flask flask-socketio flask-cors
```

> `rosdep install` above already pulls `python3-flask` / `flask-cors` / `flask-socketio` system-wide (declared in `cobotta_rest_api/package.xml`), and the `.venv` was created with `--system-site-packages`, so it sees them. This `pip install` simply pins current versions inside the venv — keep it if `flask_node` complains about a missing module.

Build the **entire** workspace (no `--packages-select`):

```bash
colcon build
source install/setup.bash
```

> This compiles **all** packages — `cobotta_rest_api`, `my_robot_interfaces` (custom messages), `async_web_server_cpp`, and `web_video_server`. **Do not skip this step:** `launch_sim.sh` only rebuilds `cobotta_rest_api`, so if this full build never ran, `web_video_server` / camera streaming will be missing at runtime.
> Build errors in `async_web_server_cpp` or `web_video_server` usually mean the C++ system dependencies (step in [Prerequisites](#prerequisites)) were not installed.

Return to project root:

```bash
cd ..
```

### 8. Database

The `db.sqlite3` file is included in the repository. It contains pre-configured users, robots, simulation locations, and example tasks. **No migrations or seeding commands are needed.**

---

## Run Procedure

Open **3 separate terminals** in the project root. Run each in order.

### Terminal 1 — Backend (Django)

```bash
poetry run python manage.py runserver
```

Starts the REST API on `http://localhost:8000`.

### Terminal 2 — Frontend (React/Vite)

```bash
npm start
```

Starts the UI on `http://localhost:3000`.

> **Prerequisite:** the full `colcon build` from [Common Setup step 7](#7-build-the-ros2-workspace) must have run at least once. `launch_sim.sh` rebuilds **only** `cobotta_rest_api` — it does not build `web_video_server`.

### Terminal 3 (first run, or after editing `cobotta_rest_api`)

```bash
cd ros2_ws/Cobotta
bash launch_sim.sh
```

### Terminal 3 (subsequent runs — skip the cobotta rebuild)
```bash
cd ros2_ws/Cobotta
SKIP_BUILD=1 bash launch_sim.sh
```

This single script starts Gazebo (headless), the ROS-Gazebo bridge, and all ROS2 nodes (`gazebo_command_node`, `gazebo_state_node`, `flask_node`, `polling_socket_node`, `web_video_server`). It waits for `/joint_states` and the Flask API to be healthy before reporting success.

> **3D GUI:** By default, Gazebo runs headless (`-s` flag). To enable the full 3D interface, edit `launch_sim.sh` and remove `-s` from the `gz sim` line.

---

### Manual node launch (alternative to `launch_sim.sh`)

If you need to start nodes individually (e.g., for debugging), each node requires its own terminal with the ROS2 environment set up:

```bash
source /opt/ros/jazzy/setup.bash
cd ros2_ws
source .venv/bin/activate
source install/setup.bash
```

Launch nodes in this order:

```bash
# Terminal A
ros2 run cobotta_rest_api flask_node

# Terminal B
ros2 run cobotta_rest_api gazebo_command_node

# Terminal C
ros2 run cobotta_rest_api gazebo_state_node

# Terminal D
ros2 run cobotta_rest_api polling_socket_node

# Terminal E — vision node uses the Poetry env, NOT .venv.
# Launch the FILE with the Poetry python — `poetry run ros2 run …` fails with
# ModuleNotFoundError: ultralytics (the ros2 entry-point shebang uses the system python).
poetry run python ros2_ws/src/cobotta_rest_api/cobotta_rest_api/vision_node.py \
    --ros-args -p camera_source:=0        # USB webcam index; or an http/rtsp URL
```

> The `vision_node` must run under the Poetry python because `ultralytics`, `mediapipe`, and `hand-gesture-engine` are only installed in the Poetry environment. All other nodes use the `.venv`.

---

## Physical robot + webcam (real COBOTTA)

Everything above runs in **simulation**. To drive the **real Denso COBOTTA** and use its
**Canon camera** for object detection, use `launch_physical.sh` instead of
`launch_sim.sh`. It runs the full Gazebo twin **and** `cobotta_node` (real arm) **and**
`vision_node` on the Canon, in parallel.

**Prerequisites (one-time):**
- Network: client PC on the robot LAN `192.168.0.0/24` (robot `192.168.0.1`, camera
  `192.168.0.90`, PC `192.168.0.100`) via a **PoE switch** (powers the camera). See
  [docs/cobotta-connection.md](docs/cobotta-connection.md).
- **Executable Token** set on the controller (`Any`, or `Ethernet` + PC IP) via a Teach
  Pendant — required for motor-on. See
  [docs/cobotta-physical-testing.md](docs/cobotta-physical-testing.md) §6b.

**Startup (3 terminals):**
```bash
# T1 — full twin + real arm + vision on the Canon (auto-started)
cd ros2_ws/Cobotta
BCAP_HOST=192.168.0.1 EXT_SPEED=20 bash launch_physical.sh
#   → wait for "B-CAP connected (ExtSpeed=20)"
#   overrides: CAMERA_SOURCE=0 (USB cam) · ENABLE_VISION=0 (no detection) · BCAP_PROVIDER=…

# T2 — Django with hardware profile (real arm follows the twin)
DRIVE_HARDWARE=1 poetry run python manage.py runserver
#   (omit DRIVE_HARDWARE to run sim-only while the robot stays connected but idle)

# T3 — frontend
npm start
```

**Quick checks:**
```bash
curl -s http://localhost:5000/api/actual-joints-real | python3 -m json.tool   # {"available":true,...}
curl -s http://localhost:5000/api/vision/state | python3 -m json.tool         # YOLO detections
```

> **Safety:** keep the teach-pendant **e-stop** in hand. `/api/stop` halts only the Gazebo
> stream — the real arm is stopped only by the e-stop. Start at `EXT_SPEED=20`.

Full field guide: [docs/cobotta-quickstart.md](docs/cobotta-quickstart.md) ·
camera/detection: [docs/cobotta-camera-object-detection.md](docs/cobotta-camera-object-detection.md).

---

## Credentials & Ports

### App login

| Role | Username | Password |
|---|---|---|
| Operator | `operator1` | `Operator_1!` |
| Manager | `manager1` | `passwordmanager1` |

### Django admin panel (`http://localhost:8000/admin/`)

| Username | Password |
|---|---|
| `admin` | `adminpassword` |

### Ports

| Service | Port |
|---|---|
| React frontend | `3000` |
| Django backend | `8000` |
| Flask ROS bridge | `5000` |
| SocketIO stream | `5001` |
| Camera stream (web_video_server) | `8080` |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ros2 run web_video_server: package not found` | Streaming repos not cloned | Run Step 2: clone `async_web_server_cpp` and `web_video_server` into `ros2_ws/src/`, then `colcon build` |
| `POST /api/vision/frame/` returns 500, log shows `hand_landmarker.task` error | Model file not downloaded | Run Step 6: `curl` download into `backend/assets/` |
| `ModuleNotFoundError: No module named 'ikpy'` | Running IK in wrong environment | `ikpy` is a Poetry dep. Run `poetry install`. Do not use `pip install` in `.venv` |
| `package 'ros_gz_bridge' not found` | Missing apt package | `sudo apt install ros-jazzy-ros-gz` |
| `colcon build` fails with C++ errors | Missing system libs | Install `build-essential cmake libboost-dev libboost-filesystem-dev libboost-thread-dev libasio-dev` |
| `No module named 'rclpy'` inside Poetry shell | ROS2 Python binding missing | Use the `.venv` for ROS2 nodes, not `poetry shell`. Poetry env does not have `--system-site-packages` |
| App loads but Simulate does nothing | Flask bridge not running | Check Terminal 3 / `launch_sim.sh` output; Flask API must respond on `:5000` |
| CORS or CSRF errors in browser | Port forwarding not set up | Follow Path B SSH forwarding — all four ports must be forwarded |
| `frontend/.env` values show as `undefined` | Template values left empty | Open `frontend/.env` and fill all six `VITE_*` variables (template ships with `''`) |
| Gesture always returns `NONE` but no error | `hand_landmarker.task` missing (silent fallback) | Same as row 2 above — download the model |
