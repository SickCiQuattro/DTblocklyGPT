@echo off
wsl.exe -d Ubuntu-24.04 -e bash -c "source /opt/ros/jazzy/setup.bash && cd /mnt/c/Users/kinno/git/DTblocklyGPT-jazzy-harmonic/ros2_ws && source .venv/bin/activate && source install/setup.bash && ros2 run ros_gz_bridge parameter_bridge --ros-args -p config_file:=./Cobotta/map.yaml"
