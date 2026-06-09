#!/bin/bash
# Launch script unificato per simulazione Digital Twin
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 1. Source environment
source /opt/ros/jazzy/setup.bash
source "$WS_ROOT/install/setup.bash"

# 2. Setup model path
export GZ_SIM_RESOURCE_PATH="$SCRIPT_DIR:$GZ_SIM_RESOURCE_PATH"

# 3. Launch Gazebo (background)
echo "▸ Avvio Gazebo..."
gz sim -r -s "$SCRIPT_DIR/worldCobotta.sdf" &
GZ_PID=$!

# 4. Launch ROS-Gazebo bridge (background)
echo "▸ Avvio bridge ROS-Gazebo..."
ros2 run ros_gz_bridge parameter_bridge \
    --ros-args -p config_file:="$SCRIPT_DIR/map.yaml" &
BRIDGE_PID=$!

# 5. Health check — attendi che /joint_states sia disponibile
echo "▸ Attendo Gazebo pronto..."
TIMEOUT=30
ELAPSED=0
until ros2 topic list 2>/dev/null | grep -q "/joint_states"; do
    sleep 0.5
    ELAPSED=$((ELAPSED + 1))
    if [ $ELAPSED -ge $((TIMEOUT * 2)) ]; then
        echo "✗ Timeout: /joint_states non disponibile dopo ${TIMEOUT}s"
        kill $GZ_PID $BRIDGE_PID 2>/dev/null
        exit 1
    fi
done
echo "✓ Gazebo pronto. /joint_states disponibile."

# 6. Avvio nodi ROS2 (tutti in background)
echo "▸ Avvio nodi ROS2..."
ros2 run cobotta_rest_api gazebo_command_node &
ros2 run cobotta_rest_api gazebo_state_node &
ros2 run cobotta_rest_api flask_node &
ros2 run cobotta_rest_api polling_socket_node &

echo ""
echo "═══════════════════════════════════════"
echo "  Digital Twin avviato con successo"
echo "  Gazebo PID: $GZ_PID"
echo "  Flask API:  http://localhost:5000"
echo "  SocketIO:   http://localhost:5001"
echo "═══════════════════════════════════════"
echo ""
echo "Premi Ctrl+C per terminare tutto."

# 7. Trap per cleanup
trap "echo 'Terminazione...'; kill 0; exit 0" SIGINT SIGTERM
wait
