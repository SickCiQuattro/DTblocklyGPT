#!/bin/bash
# Physical Cobotta: the ros2_control sim twin AND cobotta_node driving the real arm
# over b-CAP, in one launch. Run Django with DRIVE_HARDWARE=1 so the app seeds IK
# from the real encoders (closed loop) and forwards moves to the arm.
#   Override: BCAP_HOST, BCAP_PORT, BCAP_PROVIDER, EXT_SPEED, SKIP_BUILD=1
#   Object detection: ENABLE_VISION=1 (CAMERA_SOURCE/CAMERA_USER/CAMERA_PASS to override).
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BCAP_HOST="${BCAP_HOST:-192.168.0.1}"
BCAP_PORT="${BCAP_PORT:-5007}"
# VRC works for the real RC8/COBOTTA over b-CAP; the RC8 provider errors E_INVALIDARG.
BCAP_PROVIDER="${BCAP_PROVIDER:-CaoProv.DENSO.VRC}"
EXT_SPEED="${EXT_SPEED:-20}"
ENABLE_VISION="${ENABLE_VISION:-false}"
CAMERA_SOURCE="${CAMERA_SOURCE:-http://192.168.0.90/-wvhttp-01-/image.cgi}"
CAMERA_USER="${CAMERA_USER:-admin}"
CAMERA_PASS="${CAMERA_PASS:-password}"

# Fail fast if the arm is unreachable — no point bringing up the stack.
echo "|> Check robot reachability ${BCAP_HOST}:${BCAP_PORT} ..."
if ! nc -z -w 3 "$BCAP_HOST" "$BCAP_PORT" 2>/dev/null; then
    echo "X Cannot reach robot at ${BCAP_HOST}:${BCAP_PORT} — fix networking first (docs §2)."
    exit 1
fi
echo "Robot reachable."

source /opt/ros/jazzy/setup.bash

if [ -z "$SKIP_BUILD" ]; then
    echo "|> Build cobotta_rest_api (SKIP_BUILD=1 to skip)..."
    ( cd "$WS_ROOT" && colcon build --packages-select cobotta_rest_api )
fi

source "$WS_ROOT/install/setup.bash"

echo "|> Physical launch: arm ${BCAP_HOST}:${BCAP_PORT} provider=${BCAP_PROVIDER} speed=${EXT_SPEED}% vision=${ENABLE_VISION}"
echo "|> Keep the teach-pendant deadman / e-stop within reach. Start at low ext_speed."

exec ros2 launch "$SCRIPT_DIR/launch/cobotta_ros2_control.launch.py" \
    hardware:=true \
    bcap_host:="$BCAP_HOST" \
    bcap_port:="$BCAP_PORT" \
    bcap_provider:="$BCAP_PROVIDER" \
    ext_speed:="$EXT_SPEED" \
    vision:="$ENABLE_VISION" \
    camera_source:="$CAMERA_SOURCE" \
    camera_user:="$CAMERA_USER" \
    camera_pass:="$CAMERA_PASS"
