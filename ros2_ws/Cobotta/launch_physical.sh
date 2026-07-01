#!/bin/bash
# Launch script for Digital Twin + physical Cobotta hardware.
# Runs the full Gazebo sim stack (parallel twin) AND cobotta_node driving the real arm.
#
# Usage:
#   BCAP_HOST=192.168.0.1 bash launch_physical.sh
#
# Django must be started separately with DRIVE_HARDWARE=1:
#   DRIVE_HARDWARE=1 poetry run python manage.py runserver
#
# vision_node (wrist cam) must be started separately under Poetry:
#   poetry run ros2 run cobotta_rest_api vision_node \
#       --ros-args -p camera_source:=<wrist-cam-device-index>
#
# SAFETY NOTES:
#   - The real arm moves at ExtSpeed=20 (configurable via EXT_SPEED env).
#   - /stop halts the Gazebo waypoint stream only; use the teach-pendant
#     deadman / e-stop to stop the real arm immediately.
#   - Run colcon build after any change to cobotta_node.py before launching.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$WS_ROOT/.." && pwd)"

BCAP_HOST="${BCAP_HOST:-192.168.0.1}"
BCAP_PORT="${BCAP_PORT:-5007}"
EXT_SPEED="${EXT_SPEED:-20}"

# Vision (object detection). ENABLE_VISION=0 to skip. The COBOTTA Canon camera is a
# WebView HTTP snapshot source; override CAMERA_* for a USB webcam / different creds.
ENABLE_VISION="${ENABLE_VISION:-1}"
CAMERA_SOURCE="${CAMERA_SOURCE:-http://192.168.0.90/-wvhttp-01-/image.cgi}"
CAMERA_USER="${CAMERA_USER:-admin}"
CAMERA_PASS="${CAMERA_PASS:-password}"

# 1. Source environment
source /opt/ros/jazzy/setup.bash
source "$WS_ROOT/install/setup.bash"

# 2. Setup model path
export GZ_SIM_RESOURCE_PATH="$SCRIPT_DIR:$GZ_SIM_RESOURCE_PATH"

# 3. Cleanup function
cleanup() {
    echo ""
    echo "|> Shutdown Physical Twin..."
    kill $CMD_PID $STATE_PID $FLASK_PID $SOCKET_PID $BRIDGE_PID $GZ_PID $WVS_PID $HW_PID $VN_PID 2>/dev/null || true
    sleep 1
    kill -9 $CMD_PID $STATE_PID $FLASK_PID $SOCKET_PID $BRIDGE_PID $GZ_PID $WVS_PID $HW_PID $VN_PID 2>/dev/null || true
    fuser -k 5000/tcp 5001/tcp 8080/tcp 2>/dev/null || true
    pkill -9 -f "gz sim" || true
    pkill -9 -f "ruby" || true
    pkill -9 -f "vision_node.py" || true
    echo "All processes terminated."
}

trap cleanup SIGINT SIGTERM EXIT

# 4. Kill stale processes
echo "|> Cleanup stale processes..."
pkill -9 -f "gz sim" 2>/dev/null || true
pkill -9 -f "ruby" 2>/dev/null || true
pkill -9 -f "cobotta_rest_api" 2>/dev/null || true
pkill -9 -f "web_video_server" 2>/dev/null || true
pkill -9 -f "parameter_bridge" 2>/dev/null || true
pkill -9 -f "vision_node.py" 2>/dev/null || true
fuser -k 5000/tcp 5001/tcp 8080/tcp 2>/dev/null || true
sleep 1

# 5. Verify robot reachability before starting Gazebo
echo "|> Checking robot reachability at ${BCAP_HOST}:${BCAP_PORT}..."
if ! nc -z -w3 "$BCAP_HOST" "$BCAP_PORT" 2>/dev/null; then
    echo "X Cannot reach robot at ${BCAP_HOST}:${BCAP_PORT}."
    echo "  Check network settings (VM bridged mode? Robot powered? E-stop released?)."
    echo "  To run simulation only: bash launch_sim.sh"
    exit 1
fi
echo "Robot reachable."

# 6. Launch Gazebo (background)
echo "|> Start Gazebo..."
gz sim -s -r --headless-rendering "$SCRIPT_DIR/worldCobotta.sdf" &
GZ_PID=$!

# 7. Launch ROS-Gazebo bridge (background)
echo "|> Start ROS-Gazebo bridge..."
ros2 run ros_gz_bridge parameter_bridge \
    --ros-args -p config_file:="$SCRIPT_DIR/map.yaml" &
BRIDGE_PID=$!

# 8. Health check - wait for /joint_states
echo "|> Waiting for Gazebo..."
TIMEOUT=30
ELAPSED=0
until ros2 topic list 2>/dev/null | grep -q "/joint_states"; do
    sleep 0.5
    ELAPSED=$((ELAPSED + 1))
    if [ $ELAPSED -ge $((TIMEOUT * 2)) ]; then
        echo "X Timeout: /joint_states not available after ${TIMEOUT}s"
        cleanup; exit 1
    fi
done
echo "Gazebo ready. /joint_states available."

# 9. Start simulation ROS2 nodes
# NOTE: gazebo_command_node / gazebo_state_node were removed (ros2_control replaces
# them). This physical launcher still uses the legacy gz-sim-direct flow and needs
# the Fase 3 rework (ros2_control + a b-CAP hardware_interface) before it drives the
# real arm; see cobotta_ros2_control.launch.py for the simulation bring-up.
echo "|> Start simulation ROS2 nodes..."
ros2 run cobotta_rest_api flask_node &
FLASK_PID=$!
ros2 run cobotta_rest_api polling_socket_node &
SOCKET_PID=$!

echo "|> Start web_video_server (camera stream :8080)..."
ros2 run web_video_server web_video_server &
WVS_PID=$!

# 10. Health check - wait for Flask API
echo "|> Waiting for Flask API..."
FLASK_PORT="${FLASK_NODE_PORT:-5000}"
ELAPSED=0
until curl -sf "http://localhost:${FLASK_PORT}/api/actual-joints-pos" >/dev/null 2>&1; do
    sleep 0.5
    ELAPSED=$((ELAPSED + 1))
    if [ $ELAPSED -ge $((TIMEOUT * 2)) ]; then
        echo "X Timeout: Flask API not responding on :${FLASK_PORT} after ${TIMEOUT}s"
        cleanup; exit 1
    fi
done
echo "Flask API ready on :${FLASK_PORT}."

# 11. Start cobotta_node with hardware enabled
echo "|> Start cobotta_node (hardware: ${BCAP_HOST}:${BCAP_PORT}, speed=${EXT_SPEED})..."
ros2 run cobotta_rest_api cobotta_node \
    --ros-args \
    -p enable_hardware:=true \
    -p bcap_host:="${BCAP_HOST}" \
    -p bcap_port:="${BCAP_PORT}" \
    -p bcap_provider:="${BCAP_PROVIDER:-CaoProv.DENSO.VRC}" \
    -p ext_speed:="${EXT_SPEED}" &
HW_PID=$!

# 12. Start vision_node (object detection) on the camera.
# NOTE: launched via the Poetry python, NOT `ros2 run` — the ros2 entry-point shebang
# uses the system python, which lacks ultralytics/YOLO (ModuleNotFoundError).
if [ "$ENABLE_VISION" = "1" ]; then
    echo "|> Start vision_node (object detection: ${CAMERA_SOURCE})..."
    VN_PY="$WS_ROOT/src/cobotta_rest_api/cobotta_rest_api/vision_node.py"
    ( cd "$PROJECT_ROOT" && poetry run python "$VN_PY" --ros-args \
        -p camera_source:="${CAMERA_SOURCE}" \
        -p camera_user:="${CAMERA_USER}" \
        -p camera_pass:="${CAMERA_PASS}" ) &
    VN_PID=$!
else
    echo "|> Vision disabled (ENABLE_VISION=0)."
fi

echo "|> Pausing world (idle until simulation starts)..."
gz service -s /world/worldCobotta/control --reqtype gz.msgs.WorldControl \
    --reptype gz.msgs.Boolean --timeout 3000 --req 'pause: true' >/dev/null 2>&1 || true

echo ""
echo "========================================================"
echo "  Physical Twin started successfully"
echo "  Robot:      ${BCAP_HOST}:${BCAP_PORT}  (ExtSpeed=${EXT_SPEED})"
echo "  Gazebo PID: $GZ_PID"
echo "  Flask API:  http://localhost:${FLASK_PORT}"
echo "  SocketIO:   http://localhost:${POLLING_NODE_PORT:-5001}"
echo ""
echo "  Vision:     ${CAMERA_SOURCE}  (ENABLE_VISION=${ENABLE_VISION})"
echo ""
echo "  Start Django with:"
echo "    DRIVE_HARDWARE=1 poetry run python manage.py runserver"
echo "========================================================"
echo ""
echo "Press Ctrl+C to terminate everything."

wait
