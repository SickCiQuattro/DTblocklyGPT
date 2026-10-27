#!/bin/bash
# Digital Twin simulation launcher: builds cobotta_rest_api, then delegates to
# launch/cobotta_ros2_control.launch.py (gz_ros2_control + joint_trajectory_controller).
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

# Refuse to start a second stack. Launching over a running one does not fail
# loudly: gz sim starts, while flask_node, polling_socket_node and
# web_video_server die on "Address already in use" and the controller spawner
# on "Failed to configure controller". Gazebo looks alive but every node the
# app talks to is missing.
#
# FORCE=1 replaces the running stack instead of refusing.
BUSY=""
for port in 5000 5001 8080; do
    ss -ltn 2>/dev/null | grep -q ":$port " && BUSY="$BUSY $port"
done
if [ -n "$BUSY" ]; then
    if [ -n "$FORCE" ]; then
        echo "|> Ports$BUSY in use — FORCE=1, stopping the running stack..."
        # `|| true`: pkill exits 1 when nothing matches, and `set -e` would
        # abort the cleanup halfway. Children first, supervisor last: killing
        # `ros2 launch` first reparents its children to init, still holding
        # the ports.
        pkill -f web_video_server || true
        pkill -f polling_socket_node || true
        pkill -f flask_node || true
        pkill -f parameter_bridge || true
        pkill -f robot_state_publisher || true
        pkill -f "gz sim" || true
        pkill -f "ros2 launch.*cobotta_ros2_control" || true

        # Wait for the ports to free rather than sleeping a fixed time.
        for _ in $(seq 1 20); do
            STILL=""
            for port in 5000 5001 8080; do
                ss -ltn 2>/dev/null | grep -q ":$port " && STILL="$STILL $port"
            done
            [ -z "$STILL" ] && break
            sleep 1
        done
        if [ -n "$STILL" ]; then
            echo "|> Ports$STILL are still held after 20s. Something is not"
            echo "|> shutting down; check with:  ss -ltnp | grep -E ':5000|:5001|:8080'"
            exit 1
        fi
        echo "|> Stopped."
    else
        echo "|> A simulation stack is already running (ports$BUSY in use)."
        echo "|> Stop it first, or re-run with:  FORCE=1 bash launch_sim.sh"
        exit 1
    fi
fi

LAUNCH_ARGS=()
if [ "$GUI" = "1" ] || [ "$GUI" = "true" ]; then
    LAUNCH_ARGS+=("gui:=true")
fi

exec ros2 launch "$SCRIPT_DIR/launch/cobotta_ros2_control.launch.py" "${LAUNCH_ARGS[@]}" "$@"
