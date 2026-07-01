import base64
import json
import logging
import os
import shutil
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

# ── Singleton ML models (lazy, loaded once on first request) ─────────────────

_models_lock = threading.Lock()
_gesture_engine = None   # None = not attempted; False = failed permanently


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
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=400)

    engine = _get_models()

    # ── Gesture ──
    gesture = "NONE"
    if engine:
        try:
            _, stable_gesture = engine.process(frame)
            gesture = stable_gesture.upper().replace(" ", "_") if stable_gesture else "NONE"
        except Exception:
            gesture = "NONE"

    # ── Forward to Flask bridge (non-blocking best-effort) ──
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

    return JsonResponse({"gesture": gesture})


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


def get_latest_voice(max_age_s: float = 3.0) -> str:
    """Return the last recognised voice command if fresh, else ``"NONE"``."""
    with _voice_lock:
        if time.monotonic() - _latest_voice_time <= max_age_s:
            return _latest_voice
    return "NONE"


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
