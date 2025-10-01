@echo off
wsl.exe -d Ubuntu-24.04 -e bash -c "cd /mnt/c/Users/kinno/git/DTblocklyGPT/ros2_ws && source install/setup.bash && ros2 run cobotta_rest_api flask_node"