#!/usr/bin/env python3
"""Preflight check for the Cobotta digital twin stack.

Walks the whole chain — Django, Flask-ROS bridge, Gazebo, hardware service,
b-CAP, vision/gesture — and prints one PASS/FAIL/WARN/SKIP line per check.
Exits non-zero if any check FAILs.

Run with the sim (and, for hardware checks, the physical-arm) stack up:
    poetry run python testing/preflight.py

Env overrides: DJANGO_URL, FLASK_BRIDGE_URL, BCAP_HOST, BCAP_PORT.
Hardware checks (4, 5) run only when BCAP_HOST is set or DRIVE_HARDWARE=1;
otherwise they SKIP — this script never enables motors or moves the arm.
"""
import os
import sys

import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from testing.bcap_probe import probe as bcap_probe  # noqa: E402

DJANGO_URL = os.getenv("DJANGO_URL", "http://localhost:8000").rstrip("/")
FLASK_BRIDGE_URL = os.getenv("FLASK_BRIDGE_URL", "http://localhost:5000").rstrip("/")
BCAP_HOST = os.getenv("BCAP_HOST")
BCAP_PORT = int(os.getenv("BCAP_PORT", "5007"))
HARDWARE_EXPECTED = bool(BCAP_HOST) or os.getenv("DRIVE_HARDWARE", "").lower() in (
    "1", "true", "yes",
)

FRESH_S = 2.0

_failed = False


def _line(status: str, name: str, detail: str = ""):
    global _failed
    if status == "FAIL":
        _failed = True
    tag = {"PASS": "OK ", "FAIL": "FAIL", "WARN": "WARN", "SKIP": "SKIP"}[status]
    suffix = f" — {detail}" if detail else ""
    print(f"[{tag}] {name}{suffix}")


def check_django():
    try:
        resp = requests.get(DJANGO_URL + "/", timeout=3)
        if resp.status_code >= 500:
            _line("FAIL", "Django backend", f"HTTP {resp.status_code}")
        else:
            _line("PASS", "Django backend", DJANGO_URL)
    except Exception as e:
        _line("FAIL", "Django backend", str(e))


def get_health():
    resp = requests.get(FLASK_BRIDGE_URL + "/api/health", timeout=3)
    resp.raise_for_status()
    return resp.json()


def check_flask_bridge(health):
    if health is None:
        _line("FAIL", "Flask-ROS bridge", "unreachable")
        return
    _line("PASS", "Flask-ROS bridge", FLASK_BRIDGE_URL)


def check_gazebo(health):
    if health is None:
        _line("SKIP", "Gazebo twin freshness", "bridge unreachable")
        return
    age = health.get("gazebo", {}).get("joint_state_age_s")
    if age is None:
        _line("FAIL", "Gazebo twin freshness", "no /joint_states seen yet")
    elif age > FRESH_S:
        _line("FAIL", "Gazebo twin freshness", f"stale ({age}s > {FRESH_S}s)")
    else:
        _line("PASS", "Gazebo twin freshness", f"{age}s old")


def check_hardware_service(health):
    if not HARDWARE_EXPECTED:
        _line("SKIP", "Hardware move/halt service", "BCAP_HOST/DRIVE_HARDWARE not set")
        return
    if health is None:
        _line("FAIL", "Hardware move/halt service", "bridge unreachable")
        return
    hw = health.get("hardware", {})
    move_ok = hw.get("move_target_available")
    halt_ok = hw.get("halt_available")
    enc_age = hw.get("encoder_age_s")
    if not move_ok or not halt_ok:
        _line("FAIL", "Hardware move/halt service",
              f"move_target={move_ok} halt={halt_ok}")
        return
    if enc_age is None or enc_age > FRESH_S:
        _line("FAIL", "Hardware move/halt service", f"encoder stale (age={enc_age}s)")
        return
    _line("PASS", "Hardware move/halt service", f"encoder {enc_age}s old")


def check_bcap():
    if not HARDWARE_EXPECTED:
        _line("SKIP", "b-CAP probe", "BCAP_HOST/DRIVE_HARDWARE not set")
        return
    try:
        if bcap_probe(BCAP_HOST, BCAP_PORT, verbose=False):
            _line("PASS", "b-CAP probe", f"{BCAP_HOST}:{BCAP_PORT}, no latched error")
        else:
            _line("FAIL", "b-CAP probe", f"{BCAP_HOST}:{BCAP_PORT} — read failed or latched error")
    except Exception as e:
        _line("FAIL", "b-CAP probe", str(e))


def check_vision(health):
    if health is None:
        _line("WARN", "Vision / YOLO liveness", "bridge unreachable")
        return
    age = health.get("vision", {}).get("detections_age_s")
    if age is None:
        _line("WARN", "Vision / YOLO liveness", "no detections published yet")
    elif age > FRESH_S * 5:
        _line("WARN", "Vision / YOLO liveness", f"stale ({age}s)")
    else:
        _line("PASS", "Vision / YOLO liveness", f"{age}s old")


def check_gesture(health):
    if health is None:
        _line("WARN", "Gesture engine", "bridge unreachable")
        return
    age = health.get("gesture", {}).get("age_s")
    if age is None:
        _line("WARN", "Gesture engine", "no gesture reported yet (open the UI webcam panel)")
    else:
        _line("PASS", "Gesture engine", f"{age}s old")


def main():
    check_django()
    try:
        health = get_health()
    except Exception:
        health = None
    check_flask_bridge(health)
    check_gazebo(health)
    check_hardware_service(health)
    check_bcap()
    check_vision(health)
    check_gesture(health)
    sys.exit(1 if _failed else 0)


if __name__ == "__main__":
    main()
