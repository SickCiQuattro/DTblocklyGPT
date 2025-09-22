# :robot: blocklyGPT

This repository contains the prototype implementation of the project described in the [paper](https://dl.acm.org/doi/abs/10.1145/3610978.3640653).

> Gargioni, Luigi and Fogli, Daniela.
> "Integrating ChatGPT with Blockly for End-User Development of Robot Tasks"  
> *Companion of the 2024 ACM/IEEE International Conference on Human-Robot Interaction*, pages 478--482, 2024.  
> Publisher: ACM New York, NY.

## Citation

If you use this project in your research, please cite the following paper:

```bibtex
@inproceedings{gargioni2024integrating,
  title={Integrating ChatGPT with Blockly for End-User Development of Robot Tasks},
  author={Gargioni, Luigi and Fogli, Daniela},
  booktitle={Companion of the 2024 ACM/IEEE International Conference on Human-Robot Interaction},
  pages={478--482},
  year={2024}
}
```
### [Integrating ChatGPT with Blockly for End-User Development of Robot Tasks](https://dl.acm.org/doi/abs/10.1145/3610978.3640653)

This paper presents an End-User Development environment for collaborative robot programming, which integrates Open AI ChatGPT with Google Blockly. Within this environment, a user, who is neither expert in robotics nor in computer programming, can define the items characterizing the application domain (e.g., objects, actions, and locations) and define pick-and-place tasks involving these items. Task definition can be achieved with a combination of natural language and block-based interaction, which exploits the computational capabilities of ChatGPT and the graphical interaction features offered by Blockly, to check the correctness of generated robot programs and modify them through direct manipulation.


---
# Table of Contents
- [:robot: blocklyGPT](#robot-blocklygpt)
  - [Citation](#citation)
    - [Integrating ChatGPT with Blockly for End-User Development of Robot Tasks](#integrating-chatgpt-with-blockly-for-end-user-development-of-robot-tasks)
- [Table of Contents](#table-of-contents)
- [Requirements](#requirements)
- [Installing from scratch](#installing-from-scratch)
  - [Powershell](#powershell)
    - [Poetry Environment Installation](#poetry-environment-installation)
    - [Update Dependencies](#update-dependencies)
  - [WSL](#wsl)
    - [Distribution](#distribution)
    - [ROS2 Jazzy](#ros2-jazzy)
    - [Gazebo Harmonic](#gazebo-harmonic)
    - [Other Libraries](#other-libraries)
- [Complete Run Procedure](#complete-run-procedure)
  - [1. Frontend](#1-frontend)
  - [2. Backend](#2-backend)
  - [3. ROS nodes](#3-ros-nodes)
    - [Environment setup](#environment-setup)
    - [Project Build](#project-build)
    - [Load Additional Packages](#load-additional-packages)
    - [Launch the node (*finally...*)](#launch-the-node-finally)
  - [4. Gazebo bridge](#4-gazebo-bridge)
  - [5. Gazebo Simulation](#5-gazebo-simulation)
- [Quick Startup Sequence](#quick-startup-sequence)
- [Variables and Settings](#variables-and-settings)
  - [Ports](#ports)
  - [App Credentials](#app-credentials)
    - [For Django admin panel `127.0.0.1:8000/admin/`](#for-django-admin-panel-1270018000admin)
  - [Frontend Design libraries](#frontend-design-libraries)
- [Useful tools](#useful-tools)


---
# Requirements
**Windows environment (Powershell recommended)** - used to launch frontend and backend
* [Python 3.11.x](https://www.python.org/downloads/)
* [Poetry](https://python-poetry.org/docs/#installation) (pip installation is not the official one, but the easiest)
  
**Linux environment (WSL recommended)** - for Gazebo simulation and ROS implementation
* **Linux distribution** - the project was originally developed for Ubuntu 22.04 Jammy, tested and extended on Ubuntu 24.04 Noble: both can be installed directly with WSL.
* **ROS2** and **Gazebo** - the project was developed with [ROS2 Humble](https://docs.ros.org/en/humble/index.html) and [Gazebo Fortress](https://gazebosim.org/docs/fortress/install_ubuntu/); tested and extended with [ROS2 Jazzy](https://docs.ros.org/en/jazzy/index.html) and [Gazebo Harmonic](https://gazebosim.org/docs/harmonic/install_ubuntu/) (ensure correct version combinations for compatibility).

**Development environment**
* VScode (recommended)


---
# Installing from scratch
This guide covers installation on Windows with Linux via WSL.
You can install everything directly on Linux, but the program is not optimized for that setting.  
Run the following commands after installing Python 3.11.x and Poetry.

## Powershell
### Poetry Environment Installation

```bash
# Fresh install
poetry install

# Start the server
poetry run start
```
### Update Dependencies
Update project dependencies from `pyproject.toml` :
```bash
poetry update 
```
Update `pyproject.toml`  to the latest available versions:
```bash
poetry run poetryup 
```

## WSL
### Distribution
  If WSL is already installed on Windows (recommended), ensure the correct Linux version is installed.  
  Check with:
  ```bash
  wsl --list --verbose
  ```
  You should see `Ubuntu-24.04` in the list, compatible with ROS2 Jazzy and Gazebo Harmonic.
  If not installed, follow the instructions to install the correct distribution.

  Set your default Ubuntu distribution:
  ```bash
  wsl --set-default Ubuntu-24.04
  ```
  so that every time you launch `wsl`, this distribution is activated by default.

### ROS2 Jazzy
  Activate the WSL environment through Powershell and follow the official installation guide for ROS2 Jazzy ([ROS 2 Documentation: Jazzy - Setup & Installation](https://docs.ros.org/en/jazzy/Installation/Ubuntu-Install-Debs.html#system-setup)).


### Gazebo Harmonic
  Activate the WSL environment through Powershell and follow the official installation guide for Gazebo Harmonic ([Gazebo Harmonic LST - Binary Installation on Ubuntu](https://gazebosim.org/docs/harmonic/install_ubuntu/#binary-installation-on-ubuntu)).
  Verify installation with: 
  ```bash
  which gz
  ```
  If installed correctly, it should return the installation directory (usually `usr/bin/gz`).

### Other Libraries
  Navigate to `DTblocklyGPT\ros2_ws` and build a virtual environment:
  ```bash
  virtualenv .venv --system-site-packages
  ```
  Install Flask and Flask Web Socket.
  ```bash
  pip install Flask
  pip install flask-socketio
  ```

---
# Complete Run Procedure
To launch the application, you need to open multiple terminals and execute commands in the sequence indicated below.

## 1. Frontend
  Open a Powershell terminal, navigate to the project directory `frontend\src\`, and install the dependencies:
  ```bash
  npm install
  ```
  Then, move to the main directory `DTblocklyGPT\` and activate the Poetry environment:
  ```bash
  poetry env activate
  ```
  Run the `.ps1` script path returned by the previous command to activate the environment (for example: `C:\Users\repos\AppData\Local\pypoetry\Cache\virtualenvs\blocklygpt-qMnQLS6V-py3.11\Scripts\activate.ps1`).

  Start the frontend:
   ```bash
  npm start
  ```

## 2. Backend
  Open a second Powershell terminal, navigate to the main project directory `DTblocklyGPT\`  and activate the environment by running the `.ps1` script returned in the previous step.

  Start the backend:
  ```bash
  python manage.py runserver
  ```

## 3. ROS nodes
For the ROS nodes
- `flask_node.py`
  <!-- Flask application that receives API calls from the main application, and based on these calls, acts on the ROS architecture (creates nodes, sends messages, etc.); -->
- `cobotta_node.py`
  <!-- receives ROS messages (subscriber) and connects directly to the Cobotta to move the robot; -->
- `gazebo_node.py`
- `polling_socket_node.py`

located in the folder `ros2_ws\src\cobotta_rest_api\cobotta_rest_api` repeat for each node (in the order indicated above) the following launch procedure in separate terminals.

### Environment setup
Open a `wsl` terminal and source the ROS2 system environment:
```bash
  source /opt/ros/jazzy/setup.bash
```
If no output is returned, everything is installed correctly; otherwise, proceed with the ROS installation.

Navigate to the directory `DTblocklyGPT/ros2_ws/` and activate the Python environment: 
```bash
  source .venv/bin/activate
```

### Project Build
If this is your first time running the program or you have made changes to the ROS part, build the project with:
```bash
  colcon build
```
You only need to do this in the terminal where you launch the first node; it is not necessary to repeat it for all other terminals.

### Load Additional Packages
Source the workspace environment to load local packages:
```bash
  source install/setup.bash
```

### Launch the node (*finally...*)
In each configured terminal, launch a node following the order above with the command:
```bash
  #  Replace "ros_node" with the actual node name
  ros2 run cobotta_rest_api "ros_node"
```



## 4. Gazebo bridge
  Open a `wsl` terminal and source the ROS2 system environment:
  ```bash
  source /opt/ros/jazzy/setup.bash
  ```
  Navigate to the directory `DTblocklyGPT/ros2_ws`, activate the environment:
  ```bash
  source .venv/bin/activate
  ```
  Run the Gazebo Bridge using `map.yaml` configuration file:
  ```bash
  ros2 run ros_gz_bridge parameter_bridge --ros-args -p config_file:=./Cobotta/map.yaml
  ```

## 5. Gazebo Simulation
  Open a new `wsl` terminal, move in the directory `DTblocklyGPT/ros2_ws/Cobotta` and run:
  ```bash
  gz sim worldCobotta.sdf -v 4
  ```



---
# Quick Startup Sequence

To start the complete Gazebo simulation environment, run the following batch files in order:

1. `npm start.bat` - Launch frontend development server
2. `poetry run start.bat` - Start Python backend server
3. `cobotta_node.bat` - Initialize Cobotta robot node
4. `flask_node.bat` - Start Flask backend service
5. `gazebo_bridge.bat` - Launch Gazebo communication bridge
6. `gazebo.bat` - Start Gazebo simulation environment

Beware to **update** these scripts' repos **paths** according to your own.


---
# Variables and Settings
## Ports
Before running the app, set the file `frontend\.env` with the default ports for the backend and frontend:
```bash
# Backend Data
VITE_BACKEND_PROTOCOL = http://
VITE_BACKEND_HOST = localhost
VITE_BACKEND_PORT = :8000

# Frontend Data
VITE_FRONTEND_PROTOCOL = http://
VITE_FRONTEND_HOST = localhost
VITE_FRONTEND_PORT = :3000
```

## App Credentials
To log into the application, use the following credentials:

* Username: `operator1`  
Password: `Operator_1!`  
Type: `Operator`  

* Username: `manager1`  
Password: `passwordmanager1`  
Type: `Manager`  

### For Django admin panel `127.0.0.1:8000/admin/`
* Username: `admin`  
Password: `adminpassword`  
Type: `Administrator`/`Manager`

## Frontend Design libraries

* [React 18.x.x](https://it.reactjs.org/)
* [Parcel](https://parceljs.org/)
* [Ant Design](https://ant.design/)

---
# Useful tools
For updating dependencies in `package.json` , we recommend:
* Visual Studio Code Extension: [Versions Lens](https://marketplace.visualstudio.com/items?itemName=pflannery.vscode-versionlens)