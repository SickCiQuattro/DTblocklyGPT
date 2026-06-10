#!/bin/bash
# Launch script unified for Digital Twin simulation
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 1. Source environment
source /opt/ros/jazzy/setup.bash
source "$WS_ROOT/install/setup.bash"

# 2. Setup model path
export GZ_SIM_RESOURCE_PATH="$SCRIPT_DIR:$GZ_SIM_RESOURCE_PATH"

# 3. Launch Gazebo (background)
echo "|> Start Gazebo..."
gz sim -s -r "$SCRIPT_DIR/worldCobotta.sdf" &
GZ_PID=$!

# 4. Launch ROS-Gazebo bridge (background)
echo "|> Start ROS-Gazebo bridge..."
ros2 run ros_gz_bridge parameter_bridge \
    --ros-args -p config_file:="$SCRIPT_DIR/map.yaml" &
BRIDGE_PID=$!

# 5. Health check - wait for /joint_states to be available
echo "|> Waiting for Gazebo..."
TIMEOUT=30
ELAPSED=0
until ros2 topic list 2>/dev/null | grep -q "/joint_states"; do
    sleep 0.5
    ELAPSED=$((ELAPSED + 1))
    if [ $ELAPSED -ge $((TIMEOUT * 2)) ]; then
        echo "X Timeout: /joint_states not available after ${TIMEOUT}s"
        kill $GZ_PID $BRIDGE_PID 2>/dev/null
        exit 1
    fi
done
echo "Gazebo ready. /joint_states available."

# 6. Start ROS2 nodes (all in background)
echo "|> Start ROS2 nodes..."
ros2 run cobotta_rest_api gazebo_command_node &
CMD_PID=$!
ros2 run cobotta_rest_api gazebo_state_node &
STATE_PID=$!
ros2 run cobotta_rest_api flask_node &
FLASK_PID=$!
ros2 run cobotta_rest_api polling_socket_node &
SOCKET_PID=$!

echo ""
echo "===================================="
echo "  Digital Twin started successfully"
echo "  Gazebo PID: $GZ_PID"
echo "  Flask API:  http://localhost:5000"
echo "  SocketIO:   http://localhost:5001"
echo "===================================="
echo ""
echo "Press Ctrl+C to terminate everything."

# 7. Robust cleanup function
cleanup() {
    echo ""
    echo "|> Shutdown Digital Twin..."
    # Terminate processes in a clean way (SIGTERM)
    kill $CMD_PID $STATE_PID $FLASK_PID $SOCKET_PID $BRIDGE_PID $GZ_PID 2>/dev/null || true
    sleep 1
    # Force shutdown if still active (SIGKILL)
    kill -9 $CMD_PID $STATE_PID $FLASK_PID $SOCKET_PID $BRIDGE_PID $GZ_PID 2>/dev/null || true
    # Clean up network ports
    fuser -k 5000/tcp 5001/tcp 2>/dev/null || true
    # Ensure proper shutdown of Gazebo internal processes
    pkill -9 -f "gz sim" || true
    pkill -9 -f "ruby" || true
    echo "All processes terminated."
}

trap cleanup SIGINT SIGTERM EXIT
wait
