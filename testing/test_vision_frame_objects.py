"""Offline tests for browser-webcam object detection in vision_live.py.

Covers: detection shape (class/confidence/color), the 1s YOLO throttle, the
detect_objects request flag wiring, and graceful degradation when cap_color
import fails (detections without color instead of a crash).

YOLO and cap_color are fully mocked — no real model load, no cv2 HSV work.

Run:
    DJANGO_SETTINGS_MODULE=django_project_conf.settings poetry run python -m pytest testing/test_vision_frame_objects.py -v
"""
import base64
import json
import os
import sys
import time
from types import SimpleNamespace
from unittest.mock import MagicMock

import numpy as np
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

try:
    import django
    django.setup()
except Exception:
    pass

from backend.functions import vision_live


class FakeBox:
    def __init__(self, cls_id, conf, xyxy):
        self.cls = [cls_id]
        self.conf = [conf]
        self.xyxy = [xyxy]


class FakeResult:
    def __init__(self, boxes, names):
        self.boxes = boxes
        self.names = names


def _fake_frame():
    return np.zeros((10, 10, 3), dtype=np.uint8)


@pytest.fixture(autouse=True)
def _reset_vision_live_state():
    """Module-level singletons/cache persist across tests otherwise."""
    vision_live._yolo_model = None
    vision_live._classify_hsv = None
    vision_live._cap_region = None
    vision_live._last_yolo_ts = 0.0
    vision_live._last_yolo_detections = []
    yield
    vision_live._yolo_model = None
    vision_live._classify_hsv = None
    vision_live._cap_region = None
    vision_live._last_yolo_ts = 0.0
    vision_live._last_yolo_detections = []


def _mock_no_color(monkeypatch):
    monkeypatch.setattr(vision_live, "_get_cap_color_funcs", lambda: (False, False, False))


# ── detection shape ───────────────────────────────────────────────────────────

def test_detect_objects_returns_class_and_confidence(monkeypatch):
    box = FakeBox(0, 0.91, [1.0, 2.0, 3.0, 4.0])
    fake_model = MagicMock(return_value=[FakeResult([box], {0: "cell phone"})])
    monkeypatch.setattr(vision_live, "_get_yolo_model", lambda: fake_model)
    _mock_no_color(monkeypatch)

    detections = vision_live._detect_objects(_fake_frame())

    assert detections == [{"class": "cell phone", "confidence": 0.91}]


def test_detect_objects_adds_color_for_tube_classes(monkeypatch):
    box = FakeBox(0, 0.8, [1.0, 2.0, 3.0, 4.0])
    fake_model = MagicMock(return_value=[FakeResult([box], {0: "bottle"})])
    monkeypatch.setattr(vision_live, "_get_yolo_model", lambda: fake_model)
    monkeypatch.setattr(
        vision_live, "_get_cap_color_funcs",
        lambda: (
            lambda roi, background_hue=None: "blue",
            lambda frame, xyxy: frame,
            lambda frame, xyxy: None,
        ),
    )

    detections = vision_live._detect_objects(_fake_frame())

    assert detections == [{"class": "bottle", "confidence": 0.8, "color": "blue"}]


def test_detect_objects_skips_color_for_non_tube_classes(monkeypatch):
    box = FakeBox(0, 0.7, [1.0, 2.0, 3.0, 4.0])
    fake_model = MagicMock(return_value=[FakeResult([box], {0: "book"})])
    monkeypatch.setattr(vision_live, "_get_yolo_model", lambda: fake_model)
    classify_hsv = MagicMock(return_value="blue")
    monkeypatch.setattr(
        vision_live, "_get_cap_color_funcs",
        lambda: (classify_hsv, lambda frame, xyxy: frame, lambda frame, xyxy: None),
    )

    detections = vision_live._detect_objects(_fake_frame())

    assert detections == [{"class": "book", "confidence": 0.7}]
    classify_hsv.assert_not_called()


def test_detect_objects_returns_empty_when_yolo_unavailable(monkeypatch):
    monkeypatch.setattr(vision_live, "_get_yolo_model", lambda: False)

    assert vision_live._detect_objects(_fake_frame()) == []


def test_cap_color_import_failure_degrades_to_no_color(monkeypatch):
    """cap_color import failing must not crash detection — just no color field."""
    box = FakeBox(0, 0.8, [1.0, 2.0, 3.0, 4.0])
    fake_model = MagicMock(return_value=[FakeResult([box], {0: "cup"})])
    monkeypatch.setattr(vision_live, "_get_yolo_model", lambda: fake_model)
    _mock_no_color(monkeypatch)

    detections = vision_live._detect_objects(_fake_frame())

    assert detections == [{"class": "cup", "confidence": 0.8}]


# ── throttle ────────────────────────────────────────────────────────────────

def test_detect_objects_throttles_repeated_calls(monkeypatch):
    box = FakeBox(0, 0.5, [0.0, 0.0, 1.0, 1.0])
    fake_model = MagicMock(return_value=[FakeResult([box], {0: "apple"})])
    monkeypatch.setattr(vision_live, "_get_yolo_model", lambda: fake_model)
    _mock_no_color(monkeypatch)

    first = vision_live._detect_objects(_fake_frame())
    second = vision_live._detect_objects(_fake_frame())

    assert fake_model.call_count == 1
    assert first == second


def test_detect_objects_reruns_after_interval_elapses(monkeypatch):
    box = FakeBox(0, 0.5, [0.0, 0.0, 1.0, 1.0])
    fake_model = MagicMock(return_value=[FakeResult([box], {0: "apple"})])
    monkeypatch.setattr(vision_live, "_get_yolo_model", lambda: fake_model)
    _mock_no_color(monkeypatch)

    vision_live._detect_objects(_fake_frame())
    vision_live._last_yolo_ts = time.monotonic() - vision_live._YOLO_MIN_INTERVAL_S - 0.1
    vision_live._detect_objects(_fake_frame())

    assert fake_model.call_count == 2


# ── view wiring: detect_objects request flag ──────────────────────────────────

def _fake_request(detect_objects):
    frame_b64 = base64.b64encode(b"not-a-real-jpeg-but-imdecode-handles-None").decode()
    body = json.dumps({"frame": frame_b64, "detect_objects": detect_objects}).encode()
    return SimpleNamespace(
        user=SimpleNamespace(is_authenticated=True),
        method="POST",
        body=body,
    )


def test_process_vision_frame_skips_detection_when_flag_false(monkeypatch):
    monkeypatch.setattr(vision_live, "_get_models", lambda: False)  # gesture engine off
    monkeypatch.setattr(vision_live.cv2, "imdecode", lambda *a, **kw: _fake_frame())
    detect_objects_mock = MagicMock(return_value=[{"class": "apple", "confidence": 0.9}])
    monkeypatch.setattr(vision_live, "_detect_objects", detect_objects_mock)
    monkeypatch.setattr(vision_live.requests, "post", MagicMock())

    resp = vision_live.process_vision_frame(_fake_request(detect_objects=False))

    body = json.loads(resp.content)
    assert body["detections"] == []
    detect_objects_mock.assert_not_called()


def test_process_vision_frame_runs_detection_when_flag_true(monkeypatch):
    monkeypatch.setattr(vision_live, "_get_models", lambda: False)
    monkeypatch.setattr(vision_live.cv2, "imdecode", lambda *a, **kw: _fake_frame())
    detect_objects_mock = MagicMock(return_value=[{"class": "apple", "confidence": 0.9}])
    monkeypatch.setattr(vision_live, "_detect_objects", detect_objects_mock)
    monkeypatch.setattr(vision_live.requests, "post", MagicMock())

    resp = vision_live.process_vision_frame(_fake_request(detect_objects=True))

    body = json.loads(resp.content)
    assert body["detections"] == [{"class": "apple", "confidence": 0.9}]
    detect_objects_mock.assert_called_once()


def test_process_vision_frame_report_to_bridge_is_gesture_only(monkeypatch):
    """Decision: browser detections must never reach the bridge's find_object
    cache — only {"gesture"} is forwarded, regardless of detect_objects."""
    monkeypatch.setattr(vision_live, "_get_models", lambda: False)
    monkeypatch.setattr(vision_live.cv2, "imdecode", lambda *a, **kw: _fake_frame())
    monkeypatch.setattr(
        vision_live, "_detect_objects",
        lambda frame: [{"class": "apple", "confidence": 0.9}],
    )
    post_mock = MagicMock()
    monkeypatch.setattr(vision_live.requests, "post", post_mock)

    resp = vision_live.process_vision_frame(_fake_request(detect_objects=True))
    # _report runs on a daemon thread — give it a moment to fire.
    time.sleep(0.05)

    assert json.loads(resp.content)["detections"]
    post_mock.assert_called_once()
    _, kwargs = post_mock.call_args
    assert set(kwargs["json"].keys()) == {"gesture"}
