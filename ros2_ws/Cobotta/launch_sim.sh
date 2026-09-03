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

# Refuse to start a second stack. Launching over a running one does NOT fail
# loudly: gz sim starts fine (nothing of its own is bound), while flask_node,
# polling_socket_node and web_video_server each die on "Address already in
# use" and the controller spawner dies on "Failed to configure controller"
# because the first stack already configured them. What is left looks alive —
# Gazebo is up, the world ticks, `gz model --list` answers — and is missing
# every node the app talks to. Observed 2026-09-03, and it cost a round of
# debugging aimed at the wrong layer.
#
# FORCE=1 replaces the running stack instead of refusing.
BUSY=""
for port in 5000 5001 8080; do
    ss -ltn 2>/dev/null | grep -q ":$port " && BUSY="$BUSY $port"
done
if [ -n "$BUSY" ]; then
    if [ -n "$FORCE" ]; then
        echo "|> Ports$BUSY in use — FORCE=1, stopping the running stack..."
        # `|| true` on every one of these: pkill exits 1 when it matches
        # nothing, and `set -e` at the top of this script turns that into a
        # silent abort halfway through the cleanup. That is not hypothetical —
        # it happened on the first version of this block (2026-09-03): the
        # supervisor was killed, the script died before reaching its children,
        # and six nodes were left orphaned onto init still holding the ports.
        # The terminal showed the "stopping" line and nothing after it.
        #
        # Children first, supervisor last. Killing `ros2 launch` first only
        # reparents everything it was supervising to init, which is how those
        # orphans survived a cleanup that named every one of them.
        pkill -f web_video_server || true
        pkill -f polling_socket_node || true
        pkill -f flask_node || true
        pkill -f parameter_bridge || true
        pkill -f robot_state_publisher || true
        pkill -f "gz sim -s -r" || true
        pkill -f "ros2 launch.*cobotta_ros2_control" || true

        # Wait for the ports to actually free, rather than sleeping and hoping.
        # A fixed sleep is the same mistake in miniature: it asks for a
        # shutdown and then assumes it happened, and the failure it produces —
        # a fresh stack whose nodes cannot bind — looks exactly like the
        # problem this whole guard exists to prevent.
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

exec ros2 launch "$SCRIPT_DIR/launch/cobotta_ros2_control.launch.py"
