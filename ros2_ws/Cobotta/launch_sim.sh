#!/bin/bash
# Digital Twin simulation launcher.
# The per-joint gz controllers were replaced by ros2_control (gz_ros2_control +
# joint_trajectory_controller); the actual bring-up now lives in the ROS2 launch
# file. This script just builds the package and delegates to it.
#   Skip the rebuild with: SKIP_BUILD=1 bash launch_sim.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

source /opt/ros/jazzy/setup.bash

if [ -z "$SKIP_BUILD" ]; then
    echo "|> Build cobotta_rest_api (SKIP_BUILD=1 to skip)..."
    ( cd "$WS_ROOT" && colcon build --packages-select cobotta_rest_api )
fi

source "$WS_ROOT/install/setup.bash"

exec ros2 launch "$SCRIPT_DIR/launch/cobotta_ros2_control.launch.py"
