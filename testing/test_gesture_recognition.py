"""Gesture-recognition regression tests (no server, no camera — pure backend).

Run:
    poetry run python -m pytest testing/test_gesture_recognition.py -v

Covers gesture-recognition fixes, the same stale-replay defect class also
fixed on the voice command path:
- vision_live.process_vision_frame: server-side allow-list drops orphan
  labels (THREE/PINCH/POINTING) instead of forwarding them; engine_ok
  distinguishes "model failed to load" from "no hand in frame"
- simulate._wait_for_condition (gesture): rejects a gesture reported before
  the step started (stale replay), accepts one reported during the wait,
  bypasses on a 5xx from the bridge (not just ConnectionError/Timeout), and
  never hard-aborts on timeout
"""
import sys
import os
import json
import time
import base64
from unittest.mock import MagicMock

import cv2
import numpy as np
import pytest
import requests

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

try:
    import django
    django.setup()
except Exception:
    pass

from django.test import RequestFactory

from backend.functions import simulate
from backend.functions import vision_live
from backend.block_types import EventsItems


class _FakeUser:
    is_authenticated = True


class _FakeEngine:
    """Stand-in for hand_gesture.GestureEngine — returns a fixed label."""

    def __init__(self, label):
        self._label = label

    def process(self, frame):
        return frame, self._label


def _frame_b64():
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return base64.b64encode(buf.tobytes()).decode()


def _post_frame():
    request = RequestFactory().post(
        "/api/vision/frame/",
        data=json.dumps({"frame": _frame_b64()}),
        content_type="application/json",
    )
    request.user = _FakeUser()
    return vision_live.process_vision_frame(request)


@pytest.fixture(autouse=True)
def _reset_state():
    simulate.SIMULATION_STOP_EVENT.clear()
    yield
    simulate.SIMULATION_STOP_EVENT.clear()


# ── vision_live.process_vision_frame: allow-list + engine_ok ───────────────

def test_known_gesture_label_passes_through(monkeypatch):
    monkeypatch.setattr(vision_live, "_get_models", lambda: _FakeEngine("THUMBS UP"))
    resp = _post_frame()
    body = json.loads(resp.content)
    assert body["gesture"] == "THUMBS_UP"
    assert body["engine_ok"] is True


def test_orphan_gesture_label_is_dropped_to_none(monkeypatch):
    """THREE/PINCH/POINTING were removed from the block vocabulary but the
    recognizer still emits them — they must not leak past the server."""
    monkeypatch.setattr(vision_live, "_get_models", lambda: _FakeEngine("THREE"))
    resp = _post_frame()
    body = json.loads(resp.content)
    assert body["gesture"] == "NONE"


def test_engine_ok_false_when_model_failed_to_load(monkeypatch):
    """engine=False (permanent load failure) must be distinguishable from
    engine=truthy-but-no-hand-in-frame — both otherwise report gesture=NONE."""
    monkeypatch.setattr(vision_live, "_get_models", lambda: False)
    resp = _post_frame()
    body = json.loads(resp.content)
    assert body["gesture"] == "NONE"
    assert body["engine_ok"] is False


def test_engine_ok_true_when_no_hand_in_frame(monkeypatch):
    monkeypatch.setattr(vision_live, "_get_models", lambda: _FakeEngine(None))
    resp = _post_frame()
    body = json.loads(resp.content)
    assert body["gesture"] == "NONE"
    assert body["engine_ok"] is True


# ── simulate._wait_for_condition (gesture) ──────────────────────────────────

def test_gesture_fresh_match_returns_true(monkeypatch):
    """A gesture reported during the wait (not before it) must satisfy it."""

    class _FreshState:
        def __init__(self):
            self._report_time = None

        def __call__(self):
            if self._report_time is None:
                self._report_time = time.monotonic()  # "reported" on first poll
            return {
                "gesture": "THUMBS_UP",
                "gesture_age_s": time.monotonic() - self._report_time,
            }

    mock_bridge = MagicMock()
    mock_bridge.get_vision_state.side_effect = _FreshState()
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    condition_block = {
        "type": EventsItems.GESTURE.value,
        "fields": {"GESTURE_TYPE": "THUMBS_UP"},
    }
    result = simulate._wait_for_condition(condition_block, timeout=1.0)

    assert result is True


def test_gesture_stale_replay_does_not_satisfy_new_step(monkeypatch):
    """A gesture cached from before the step started must not satisfy it —
    same stale-replay class fixed on voice."""
    stale_report_time = time.monotonic()
    time.sleep(0.05)  # the step's entry_time will be measurably after this

    def fake_get_vision_state():
        return {
            "gesture": "THUMBS_UP",
            "gesture_age_s": time.monotonic() - stale_report_time,
        }

    mock_bridge = MagicMock()
    mock_bridge.get_vision_state.side_effect = fake_get_vision_state
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)

    condition_block = {
        "type": EventsItems.GESTURE.value,
        "fields": {"GESTURE_TYPE": "THUMBS_UP"},
    }
    result = simulate._wait_for_condition(condition_block, timeout=0.1)

    assert result is False


def test_gesture_missing_age_field_is_permissive(monkeypatch):
    """An older bridge that doesn't report gesture_age_s must not regress —
    fall back to matching on value alone."""
    mock_bridge = MagicMock()
    mock_bridge.get_vision_state.return_value = {"gesture": "THUMBS_UP"}
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    condition_block = {
        "type": EventsItems.GESTURE.value,
        "fields": {"GESTURE_TYPE": "THUMBS_UP"},
    }
    result = simulate._wait_for_condition(condition_block, timeout=1.0)

    assert result is True


def test_gesture_bridge_unreachable_bypasses(monkeypatch):
    mock_bridge = MagicMock()
    mock_bridge.get_vision_state.side_effect = requests.exceptions.ConnectionError("refused")
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    condition_block = {
        "type": EventsItems.GESTURE.value,
        "fields": {"GESTURE_TYPE": "THUMBS_UP"},
    }
    result = simulate._wait_for_condition(condition_block, timeout=1.0)

    assert result is True


def test_gesture_bridge_5xx_bypasses_instead_of_raising(monkeypatch):
    """A 5xx from the bridge (HTTPError) must bypass like ConnectionError/
    Timeout already do, not escape as an unhandled exception."""
    mock_bridge = MagicMock()
    mock_bridge.get_vision_state.side_effect = requests.exceptions.HTTPError("500")
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)

    condition_block = {
        "type": EventsItems.GESTURE.value,
        "fields": {"GESTURE_TYPE": "THUMBS_UP"},
    }
    result = simulate._wait_for_condition(condition_block, timeout=1.0)

    assert result is True


def test_gesture_timeout_does_not_abort(monkeypatch):
    mock_bridge = MagicMock()
    mock_bridge.get_vision_state.return_value = {"gesture": "NONE", "gesture_age_s": 0.0}
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)

    condition_block = {
        "type": EventsItems.GESTURE.value,
        "fields": {"GESTURE_TYPE": "THUMBS_UP"},
    }
    result = simulate._wait_for_condition(condition_block, timeout=0.05)

    assert result is False
    assert not simulate.SIMULATION_STOP_EVENT.is_set()
    mock_bridge.notify.assert_any_call(
        "/api/human-step-timeout", {"condition": "gesture", "value": "THUMBS_UP"}
    )


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
