@echo off
wsl.exe -d Ubuntu-24.04 -e bash -c "cd /mnt/c/Users/kinno/git/DTblocklyGPT-jazzy-harmonic/ros2_ws/Cobotta && gz sim -r -v 4 worldCobotta.sdf"
