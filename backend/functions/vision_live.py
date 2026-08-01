import base64
import json
import logging
import os
import shutil
import sys
import threading
import time
from pathlib import Path

import cv2
import numpy as np
import requests
from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt

logger = logging.getLogger(__name__)

FLASK_BRIDGE_URL = os.getenv("FLASK_BRIDGE_URL", "http://localhost:5000").rstrip("/")

# backend/functions/vision_live.py → ../../assets/hand_landmarker.task
_LOCAL_MODEL = Path(__file__).parent.parent / "assets" / "hand_landmarker.task"

# backend/functions/vision_live.py → ../../yolov8n.pt (repo root — the same
# weights file vision_node.py loads by relative name on the ROS side).
_YOLO_WEIGHTS = Path(__file__).parent.parent.parent / "yolov8n.pt"

# cap_color.py is pure OpenCV/numpy (no ROS imports — see its own docstring),
# so it's safe to import directly from the ROS package tree without ROS
# itself being installed/sourced. Same sys.path pattern as testing/test_cap_color.py.
_ROS_PKG_DIR = str(Path(__file__).parent.parent.parent / "ros2_ws" / "src" / "cobotta_rest_api")

# ── Singleton ML models (lazy, loaded once on first request) ─────────────────

_models_lock = threading.Lock()
_gesture_engine = None   # None = not attempted; False = failed permanently
_yolo_model = None       # None = not attempted; False = failed permanently
_classify_hsv = None     # None = not attempted; False = failed permanently (color optional)
_cap_region = None
_sample_background_hue = None

# Detection results are cached and only refreshed at this interval — YOLOv8n on
# CPU (no GPU on this VM) takes ~200-400ms/frame; frames arrive from the
# browser every 300ms (useWebcamVision.CAPTURE_INTERVAL_MS), so without a
# throttle the request queue would grow unbounded.
_YOLO_MIN_INTERVAL_S = 1.0
_yolo_cache_lock = threading.Lock()
_last_yolo_ts = 0.0
_last_yolo_detections: list = []

# Gestures the app actually exposes as a block condition (see
# frontend/src/constants/recognitionRegistry.ts, the single source of truth
# on the frontend side). The recognizer can emit more labels (THREE, PINCH,
# POINTING) than this — those are filtered to NONE here so they never leak
# into the bridge cache, the ROS topic, or the UI as a phantom "detected"
# value for a gesture nobody can select.
_GESTURE_WORDS = {"THUMBS_UP", "THUMBS_DOWN", "OPEN_HAND", "FIST", "PEACE", "OK"}

# Mirrors vision_node.py's _TUBE_CLASSES — COCO classes that get a cap-colour pass.
_TUBE_CLASSES = ("bottle", "cup")


def _ensure_gesture_model() -> bool:
    """Copy hand_landmarker.task from project assets into the package dir if missing."""
    try:
        import importlib.resources
        pkg_assets = importlib.resources.files("hand_gesture") / "assets"
        pkg_path = Path(str(pkg_assets)) / "hand_landmarker.task"
        if pkg_path.exists():
            return True
        if not _LOCAL_MODEL.exists():
            logger.error(
                "hand_landmarker.task missing from both package and local assets. "
                "Download it with: curl -L "
                "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
                "hand_landmarker/float16/latest/hand_landmarker.task "
                "-o backend/assets/hand_landmarker.task"
            )
            return False
        shutil.copyfile(_LOCAL_MODEL, pkg_path)
        logger.info("hand_landmarker.task copied to package assets: %s", pkg_path)
        return True
    except Exception as exc:
        logger.error("_ensure_gesture_model failed: %s", exc)
        return False


def _get_models():
    global _gesture_engine
    with _models_lock:
        if _gesture_engine is None:
            try:
                if _ensure_gesture_model():
                    from hand_gesture.engine import GestureEngine
                    _gesture_engine = GestureEngine()
                else:
                    _gesture_engine = False
            except Exception as exc:
                logger.error("GestureEngine init failed (gesture disabled): %s", exc)
                _gesture_engine = False

    return _gesture_engine


def _get_yolo_model():
    global _yolo_model
    with _models_lock:
        if _yolo_model is None:
            try:
                from ultralytics import YOLO
                # Auto-downloads to this path on first call if missing — same
                # behavior as vision_node.py's YOLO(p("yolo_model")) call.
                _yolo_model = YOLO(str(_YOLO_WEIGHTS))
            except Exception as exc:
                logger.error("YOLO init failed (object detection disabled): %s", exc)
                _yolo_model = False

    return _yolo_model


def _get_cap_color_funcs():
    """Lazy-import cap_color.py from the ROS package tree (pure OpenCV/numpy,
    no ROS dependency — see its docstring). Colour classification is optional:
    on failure, detections just come back without a "color" field."""
    global _classify_hsv, _cap_region, _sample_background_hue
    with _models_lock:
        if _classify_hsv is None:
            try:
                if _ROS_PKG_DIR not in sys.path:
                    sys.path.insert(0, _ROS_PKG_DIR)
                from cobotta_rest_api.cap_color import cap_region, classify_hsv, sample_background_hue
                _classify_hsv = classify_hsv
                _cap_region = cap_region
                _sample_background_hue = sample_background_hue
            except Exception as exc:
                logger.warning("cap_color import failed (detections will have no color): %s", exc)
                _classify_hsv = False
                _cap_region = False
                _sample_background_hue = False

    return _classify_hsv, _cap_region, _sample_background_hue


def _detect_objects(frame) -> list:
    """YOLOv8n object detection on a browser webcam frame, cap-colour enriched
    for bottle/cup classes — mirrors vision_node.py's _run_yolo (ROS side),
    minus the bbox/center fields (this path is display-only, see decision in
    the plan: browser detections never feed the bridge's find_object cache)."""
    global _last_yolo_ts, _last_yolo_detections

    with _yolo_cache_lock:
        if time.monotonic() - _last_yolo_ts < _YOLO_MIN_INTERVAL_S:
            return _last_yolo_detections

    model = _get_yolo_model()
    if not model:
        return []

    try:
        results = model(frame, conf=0.35, verbose=False)
        classify_hsv, cap_region, sample_background_hue = _get_cap_color_funcs()
        detections = []
        for result in results:
            for box in result.boxes:
                class_id = int(box.cls[0])
                confidence = float(box.conf[0])
                class_name = result.names[class_id]
                detection = {"class": class_name, "confidence": round(confidence, 4)}
                if class_name in _TUBE_CLASSES and classify_hsv and cap_region:
                    xyxy = [float(v) for v in box.xyxy[0]]
                    bg_hue = sample_background_hue(frame, xyxy) if sample_background_hue else None
                    color = classify_hsv(cap_region(frame, xyxy), background_hue=bg_hue)
                    if color:
                        detection["color"] = color
                detections.append(detection)
    except Exception as exc:
        logger.warning("YOLO inference error: %s", exc)
        return []

    with _yolo_cache_lock:
        _last_yolo_ts = time.monotonic()
        _last_yolo_detections = detections
    return detections


# ── Django view ──────────────────────────────────────────────────────────────

@csrf_exempt
def process_vision_frame(request: HttpRequest) -> JsonResponse:
    if not request.user.is_authenticated:
        return JsonResponse({"error": "unauthorized"}, status=401)
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        import json
        data = json.loads(request.body)
        b64 = data.get("frame", "")
        if not b64:
            return JsonResponse({"error": "frame required"}, status=400)

        img_bytes = base64.b64decode(b64)
        arr = np.frombuffer(img_bytes, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return JsonResponse({"error": "invalid image"}, status=400)
        detect_objects_flag = bool(data.get("detect_objects", False))
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=400)

    engine = _get_models()

    # ── Gesture ──
    gesture = "NONE"
    if engine:
        try:
            _, stable_gesture = engine.process(frame)
            code = stable_gesture.upper().replace(" ", "_") if stable_gesture else "NONE"
            # Recognizer can emit more labels (THREE, PINCH, POINTING) than
            # the app exposes as a block condition — drop anything outside
            # the allow-list instead of forwarding a phantom "detected".
            gesture = code if code in _GESTURE_WORDS else "NONE"
        except Exception:
            gesture = "NONE"
    # engine is False only after a permanent model-load failure (as opposed
    # to "no hand in this frame", which still reports "NONE" with engine
    # truthy) — the frontend needs this to tell the two apart.
    engine_ok = engine is not False

    # ── Objects (test-screen only — never fed to the bridge, see below) ──
    detections = _detect_objects(frame) if detect_objects_flag else []

    # ── Forward to Flask bridge (non-blocking best-effort) ──
    # Gesture only, by design: the bridge's find_object cache during a real
    # task run must stay sourced exclusively from vision_node (robot/USB
    # camera), not the operator's test webcam — this endpoint's detections
    # never reach it.
    def _report():
        try:
            requests.post(
                f"{FLASK_BRIDGE_URL}/api/vision/report",
                json={"gesture": gesture},
                timeout=0.8,
            )
        except Exception:
            pass

    threading.Thread(target=_report, daemon=True).start()

    return JsonResponse({"gesture": gesture, "detections": detections, "engine_ok": engine_ok})


# ── Voice command (browser Web Speech API → Django cache) ────────────────────
# The browser recognises speech locally and POSTs the matched command word
# (YES / NO / DONE / PROCEED). We cache it in-process so the simulation loop in
# simulate.py (same Django process) can poll it — no ROS bridge, no audio here.

_voice_lock = threading.Lock()
_latest_voice = "NONE"
_latest_voice_time = 0.0

# Commands the frontend may send. Matching/synonyms (incl. Italian) live in the
# browser hook; the backend only validates and stores the normalised code.
_VOICE_WORDS = {"YES", "NO", "DONE", "PROCEED"}


def get_latest_voice(max_age_s: float = 3.0, consume: bool = False) -> str:
    """Return the last recognised voice command if fresh, else ``"NONE"``.

    consume=True clears the cache after reading, so one utterance satisfies
    exactly one waiting condition instead of every condition polled within
    the freshness window (back-to-back human_action steps, AND of two voice
    leaves, etc).
    """
    global _latest_voice, _latest_voice_time
    with _voice_lock:
        if time.monotonic() - _latest_voice_time <= max_age_s:
            word = _latest_voice
            if consume:
                _latest_voice = "NONE"
                _latest_voice_time = 0.0
            return word
    return "NONE"


def reset_voice() -> None:
    """Drop any cached voice command so a word spoken before a step starts
    can't satisfy it (stale replay)."""
    global _latest_voice, _latest_voice_time
    with _voice_lock:
        _latest_voice = "NONE"
        _latest_voice_time = 0.0


@csrf_exempt
def process_voice_command(request: HttpRequest) -> JsonResponse:
    """Store the latest voice command recognised by the operator's browser."""
    global _latest_voice, _latest_voice_time
    if not request.user.is_authenticated:
        return JsonResponse({"error": "unauthorized"}, status=401)
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        data = json.loads(request.body)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=400)

    word = str(data.get("voice", "")).strip().upper()
    if word not in _VOICE_WORDS:
        return JsonResponse({"error": "unknown voice command", "voice": word}, status=400)

    with _voice_lock:
        _latest_voice = word
        _latest_voice_time = time.monotonic()

    return JsonResponse({"status": "ok", "voice": word})


# ── Human confirm (operator presses "Confirm" in the Digital Twin panel) ─────
# The manual counterpart to gesture/voice/find_object as a human_action resume
# trigger — no sensor, just a button. Same cache shape as voice (reset at step
# entry, consume on read) so a press can't replay across steps or runs.

_confirm_lock = threading.Lock()
_confirm_pending = False
_confirm_time = 0.0


def get_confirm(max_age_s: float = 3.0, consume: bool = False) -> bool:
    """Return True if the operator pressed Confirm recently, else False.

    consume=True clears the pending flag after reading, so one press satisfies
    exactly one waiting step instead of every step polled within the window.
    """
    global _confirm_pending
    with _confirm_lock:
        if _confirm_pending and time.monotonic() - _confirm_time <= max_age_s:
            if consume:
                _confirm_pending = False
            return True
    return False


def reset_confirm() -> None:
    """Drop any pending confirm so a press from before a step starts can't
    satisfy it (stale replay — same class of bug fixed on voice/gesture)."""
    global _confirm_pending, _confirm_time
    with _confirm_lock:
        _confirm_pending = False
        _confirm_time = 0.0


@csrf_exempt
def process_human_confirm(request: HttpRequest) -> JsonResponse:
    """Record that the operator pressed the manual Confirm button."""
    global _confirm_pending, _confirm_time
    if not request.user.is_authenticated:
        return JsonResponse({"error": "unauthorized"}, status=401)
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    with _confirm_lock:
        _confirm_pending = True
        _confirm_time = time.monotonic()

    return JsonResponse({"status": "ok"})
