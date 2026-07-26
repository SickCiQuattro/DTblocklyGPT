"""Voice-command regression tests (no server, no browser — pure backend).

Run:
    poetry run python -m pytest testing/test_voice_command.py -v

Covers the voice-command fixes:
- vision_live.get_latest_voice / reset_voice: freshness window, consume-on-read
- vision_live.process_voice_command: accepted words, auth, method guard
- simulate._wait_for_condition (voice): drains stale words before waiting and
  consumes on read (stale replay / one-word-satisfies-many), a null
  VOICE_WORD field falls back to the default, timeout never aborts
"""
import sys
import os
import json
import time
from unittest.mock import MagicMock

import pytest

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
    def __init__(self, authenticated=True):
        self.is_authenticated = authenticated


def _post_voice(word, authenticated=True):
    request = RequestFactory().post(
        "/api/vision/voice/",
        data=json.dumps({"voice": word}),
        content_type="application/json",
    )
    request.user = _FakeUser(authenticated)
    return vision_live.process_voice_command(request)


@pytest.fixture(autouse=True)
def _reset_state():
    vision_live.reset_voice()
    simulate.SIMULATION_STOP_EVENT.clear()
    yield
    vision_live.reset_voice()
    simulate.SIMULATION_STOP_EVENT.clear()


# ── vision_live.get_latest_voice / reset_voice ──────────────────────────────

def test_get_latest_voice_fresh():
    vision_live._latest_voice = "YES"
    vision_live._latest_voice_time = time.monotonic()
    assert vision_live.get_latest_voice() == "YES"


def test_get_latest_voice_expires_outside_window():
    vision_live._latest_voice = "YES"
    vision_live._latest_voice_time = time.monotonic() - 10.0
    assert vision_live.get_latest_voice(max_age_s=3.0) == "NONE"


def test_get_latest_voice_consume_clears_cache():
    vision_live._latest_voice = "YES"
    vision_live._latest_voice_time = time.monotonic()

    first = vision_live.get_latest_voice(consume=True)
    second = vision_live.get_latest_voice()

    assert first == "YES"
    assert second == "NONE"


def test_get_latest_voice_no_consume_keeps_cache():
    vision_live._latest_voice = "YES"
    vision_live._latest_voice_time = time.monotonic()

    first = vision_live.get_latest_voice()
    second = vision_live.get_latest_voice()

    assert first == "YES"
    assert second == "YES"


def test_reset_voice_clears_cache():
    vision_live._latest_voice = "YES"
    vision_live._latest_voice_time = time.monotonic()

    vision_live.reset_voice()

    assert vision_live.get_latest_voice() == "NONE"


# ── vision_live.process_voice_command ───────────────────────────────────────

def test_process_voice_command_accepts_known_word():
    resp = _post_voice("yes")  # lower-case, must be normalised to YES

    assert resp.status_code == 200
    assert vision_live.get_latest_voice() == "YES"


def test_process_voice_command_rejects_unknown_word():
    resp = _post_voice("MAYBE")
    assert resp.status_code == 400
    assert vision_live.get_latest_voice() == "NONE"


def test_process_voice_command_requires_auth():
    resp = _post_voice("YES", authenticated=False)
    assert resp.status_code == 401


def test_process_voice_command_requires_post():
    request = RequestFactory().get("/api/vision/voice/")
    request.user = _FakeUser()
    resp = vision_live.process_voice_command(request)
    assert resp.status_code == 405


# ── simulate._wait_for_condition (voice) ────────────────────────────────────

def test_wait_for_voice_heard_returns_true(monkeypatch):
    monkeypatch.setattr("backend.functions.vision_live.reset_voice", MagicMock())
    monkeypatch.setattr(
        "backend.functions.vision_live.get_latest_voice",
        MagicMock(return_value="YES"),
    )

    condition_block = {
        "type": EventsItems.VOICE.value,
        "fields": {"VOICE_WORD": "YES"},
    }
    result = simulate._wait_for_condition(condition_block, timeout=1.0)

    assert result is True


def test_wait_for_voice_timeout_does_not_abort(monkeypatch):
    """Unlike find_object, voice must not hard-abort the task on timeout."""
    monkeypatch.setattr("backend.functions.vision_live.reset_voice", MagicMock())
    monkeypatch.setattr(
        "backend.functions.vision_live.get_latest_voice",
        MagicMock(return_value="NONE"),
    )
    mock_bridge = MagicMock()
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)

    condition_block = {
        "type": EventsItems.VOICE.value,
        "fields": {"VOICE_WORD": "YES"},
    }
    result = simulate._wait_for_condition(condition_block, timeout=0.05)

    assert result is False
    assert not simulate.SIMULATION_STOP_EVENT.is_set()
    mock_bridge.notify.assert_any_call(
        "/api/human-step-timeout", {"condition": "voice", "value": "YES"}
    )


def test_wait_for_voice_null_field_uses_default(monkeypatch):
    """fields.VOICE_WORD: null must not defeat the "YES" default."""
    monkeypatch.setattr("backend.functions.vision_live.reset_voice", MagicMock())
    monkeypatch.setattr(
        "backend.functions.vision_live.get_latest_voice",
        MagicMock(return_value="YES"),
    )

    condition_block = {
        "type": EventsItems.VOICE.value,
        "fields": {"VOICE_WORD": None},
    }
    result = simulate._wait_for_condition(condition_block, timeout=1.0)

    assert result is True


def test_wait_for_voice_drains_stale_word_before_waiting(monkeypatch):
    """A word cached before the step starts must not satisfy it — the branch
    has to drain the cache at entry (stale replay)."""
    mock_reset = MagicMock()
    mock_get = MagicMock(return_value="NONE")
    monkeypatch.setattr("backend.functions.vision_live.reset_voice", mock_reset)
    monkeypatch.setattr("backend.functions.vision_live.get_latest_voice", mock_get)
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)

    condition_block = {
        "type": EventsItems.VOICE.value,
        "fields": {"VOICE_WORD": "YES"},
    }
    result = simulate._wait_for_condition(condition_block, timeout=0.05)

    assert result is False
    mock_reset.assert_called_once()


def test_wait_for_voice_consumes_on_read(monkeypatch):
    """One utterance must satisfy exactly one waiting condition, not every
    condition polled within the freshness window."""
    monkeypatch.setattr("backend.functions.vision_live.reset_voice", MagicMock())
    mock_get = MagicMock(return_value="YES")
    monkeypatch.setattr("backend.functions.vision_live.get_latest_voice", mock_get)

    condition_block = {
        "type": EventsItems.VOICE.value,
        "fields": {"VOICE_WORD": "YES"},
    }
    simulate._wait_for_condition(condition_block, timeout=1.0)

    mock_get.assert_called_with(consume=True)


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
