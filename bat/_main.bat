wt -p "Command Prompt" -d . cmd /k "cd C:\repos\blocklyGPT && npm start"; new-tab -p "Command Prompt" -d . cmd /k "cd C:\repos\blocklyGPT && poetry run start"; new-tab -p "WSL" -d . wsl -e bash -c "cd /mnt/c/repos/blocklyGPT/ros2_ws && source install/setup.bash && ros2 run cobotta_rest_api flask_node"; new-tab -p "WSL" -d . wsl -e bash -c "cd /mnt/c/repos/blocklyGPT/ros2_ws && source install/setup.bash && ros2 run cobotta_rest_api cobotta_node"; new-tab -p "WSL" -d . wsl -e bash -c "cd /mnt/c/repos/blocklyGPT/ros2_ws && source install/setup.bash && cd /mnt/c/repos/blocklyGPT/ros2_ws/cobotta && ros2 run ros_gz_bridge parameter_bridge --ros-args -p config_file:=../Cobotta/map.yaml"




