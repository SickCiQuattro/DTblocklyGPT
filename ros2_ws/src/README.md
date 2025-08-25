Clone this repository inside ros2_ws and call it src
```bash
git clone {url} src
```

# Set environment 

## create virtual environment (move to ros2_ws directory)
```bash
virtualenv .venv --system-site-packages
```

## import ROS library in PyCharm
Linux
```bash
vim /home/{name}/.local/JetBrains/Toolbox/apps/{pycharm_version}/bin/pycharm.sh
```

WSL
```bash
vim /home/{name}/.cache/JetBrains/RemoteDev/dist/{cached_pycharm_version}/bin/pycharm.sh
```

insert the next line:
```bash
. /opt/ros/humble/setup.sh 
```


# Flask 

Install Flask

```bash
pip install Flask
```

Install Flask Web Socket 

```bash
pip install flask-socketio
```


Add dependecy in ros project (in ros2_ws directory)
```bash
apt-get install python3-rosdep
rosdep install --from-paths src -y --ignore-src 
```


## Start environment correctly (follow the next lines in order)

for each terminal go in ros2_ws directory (this project would be clone in ros2_ws/src)

```bash
colcon build
source install/setup.bash
```

```bash
ros2 run cobotta_rest_api flask_node
```

```bash
ros2 run cobotta_rest_api cobotta_node
```

```bash
ros2 run cobotta_rest_api polling_socket_node
```

```bash
ros2 run cobotta_rest_api gazebo_node
```


start gazebo simulator and bridge with ROS2

move in Cobotta directory (where there is the sdf model file)
```bash
ign gazebo -v 4 worldCobotta.sdf
```

bridge run using map.yaml conf file (insert the correct path)
```bash
 ros2 run ros_gz_bridge parameter_bridge --ros-args -p config_file:=../Cobotta/map.yaml
```

