"""Voice-command regression tests (no server, no browser — pure backend).

Run:
    poetry run python -m pytest testing/test_voice_command.py -v

Covers the voice-command fixes:
- vision_live.get_latest_voice / reset_voice: freshness window, consume-on-read
- vision_live.process_voice_command: accepted words, auth, method guard
- simulate._wait_for_condition (voice): drains stale words before waiting and
  consumes on read (stale replay / one-word-satisfies-many), a null
  VOICE_WORD field falls back to the default, timeout never aborts
- the browser recognizer's restart budget (source-parsed, see the last section)
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


# ── `accepted` must mean "resolved the step" ────────────────────────────────
#
# It used to be written from "the word is in the vocabulary", while the gesture
# channel writes `observed == expected` and the button hardcodes True. Three
# meanings under one field name, and `analisi.py`'s `primo_tentativo` — the top
# row of the Part-B measures table — reads it as the strictest of the three.
#
# The live consequence: PB-B-voce waits for DONE, and the browser maps the most
# natural Italian reply ("sì") to YES. Saying "sì" once produced an attempt with
# accepted=True on a step that then timed out, and the CSV reported
# tentativi=1, primo_tentativo=SI, scaduto=SI on the same row.


def _voice_attempts(monkeypatch):
    """Capture what the endpoint writes to the study log."""
    written = []
    monkeypatch.setattr(
        vision_live.study_log, "log_event",
        lambda event, **fields: written.append({"event": event, **fields}),
    )
    return written


def test_in_vocabulary_word_is_not_accepted_when_another_is_expected(monkeypatch):
    written = _voice_attempts(monkeypatch)
    vision_live.set_expected_voice("DONE")
    try:
        # What the browser actually sends after mapping "sì" (useVoiceCommand.ts).
        _post_voice("YES")
    finally:
        vision_live.set_expected_voice(None)

    attempt = next(w for w in written if w["event"] == "attempt")
    assert attempt["value"] == "YES"
    assert attempt["accepted"] is False, (
        "una parola del vocabolario ma diversa da quella attesa non risolve il passo"
    )
    assert attempt["in_vocabulary"] is True, "resta distinguibile dal rumore"
    assert attempt["expected"] == "DONE"


def test_the_expected_word_is_accepted(monkeypatch):
    written = _voice_attempts(monkeypatch)
    vision_live.set_expected_voice("DONE")
    try:
        _post_voice("DONE")
    finally:
        vision_live.set_expected_voice(None)

    attempt = next(w for w in written if w["event"] == "attempt")
    assert attempt["accepted"] is True


def test_nothing_is_accepted_outside_a_voice_step(monkeypatch):
    """No step is waiting, so no utterance can have resolved one."""
    written = _voice_attempts(monkeypatch)
    vision_live.set_expected_voice(None)
    _post_voice("DONE")

    attempt = next(w for w in written if w["event"] == "attempt")
    assert attempt["accepted"] is False
    assert attempt["expected"] is None


def test_out_of_vocabulary_word_is_still_recorded(monkeypatch):
    """An utterance the browser could not classify is an attempt too — it is
    the only server-side evidence that the participant tried and was refused."""
    written = _voice_attempts(monkeypatch)
    _post_voice("MAYBE")

    attempt = next(w for w in written if w["event"] == "attempt")
    assert attempt["accepted"] is False
    assert attempt["in_vocabulary"] is False


# ─────────────────────────────────────────────────────────────────────────────
# Browser-side recognizer lifecycle.
#
# The bug this guards is invisible from the backend: the voice-command block
# turns the microphone on when the RUN starts, not when the voice step is
# reached, and Chrome ends a continuous recognition session by itself after a
# stretch of silence. Every such end used to spend one of five restart
# attempts, and only a recognized RESULT reset the counter — so an operator
# waiting quietly through half a minute of robot motion exhausted the budget
# and the recognizer gave up before the step that needed it began. Gestures
# never showed this because MediaPipe has no session lifecycle.
#
# There is no JS test runner in this project (same constraint as
# test_block_delete_paths.py / test_wcag_contrast.py), so this parses the
# TypeScript source and checks the property that broke: a session that lasted
# resets the budget, not only a result.
# ─────────────────────────────────────────────────────────────────────────────

_SPEECH_TS = os.path.join(
    os.path.dirname(__file__), "..", "frontend", "src", "utils", "speechRecognition.ts"
)


def _speech_source() -> str:
    return open(_SPEECH_TS, encoding="utf-8").read()


def _onend_body(source: str) -> str:
    start = source.index("recognition.onend")
    return source[start:source.index("return recognition", start)]


def test_a_lasting_session_resets_the_restart_budget():
    body = _onend_body(_speech_source())
    assert "sessionStartedAt" in body and "restartAttempts = 0" in body, (
        "onend non azzera piu' il budget in base alla DURATA della sessione. "
        "Senza, ogni chiusura per silenzio consuma un tentativo e il "
        "riconoscitore muore mentre l'operatore aspetta in silenzio il passo "
        "vocale — che e' il caso normale, non un guasto."
    )


def test_the_budget_still_exists_for_a_dead_mic():
    """The duration reset must not become 'never give up'.

    The cap is what stops an audio-capture/network failure — which fires
    error->end immediately — from spinning forever.
    """
    body = _onend_body(_speech_source())
    assert "restartAttempts >= MAX_RESTART_ATTEMPTS" in body, (
        "il tetto ai riavvii e' sparito: un microfono morto rilancia "
        "all'infinito."
    )
    assert "restartAttempts += 1" in body, "il contatore non viene piu' incrementato"


def test_session_start_is_stamped_on_every_start():
    """Both entry points must stamp it, or the first end mis-measures itself."""
    source = _speech_source()
    assert source.count("sessionStartedAt = Date.now()") >= 2, (
        "sessionStartedAt viene marcato in un solo punto: startListening e "
        "il riavvio dentro onend devono marcarlo entrambi, altrimenti la "
        "durata della prima sessione e' misurata da zero."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Recognizer language.
#
# The Web Speech API takes ONE language and the browser allows ONE recognition
# session, shared by the voice-command block and the chat dictation button. It
# used to be read from navigator.language in both, which made a study result
# depend on the locale of the laptop the session ran on — silently, since
# nothing on screen says which language is being listened for.
# ─────────────────────────────────────────────────────────────────────────────

_REGISTRY_TS = os.path.join(
    os.path.dirname(__file__), "..", "frontend", "src", "constants", "recognitionRegistry.ts"
)
_VOICE_HOOK_TS = os.path.join(
    os.path.dirname(__file__), "..", "frontend", "src", "hooks", "useVoiceCommand.ts"
)
_COMPOSER_TSX = os.path.join(
    os.path.dirname(__file__), "..", "frontend", "src", "components", "ChatComposer.tsx"
)


def test_no_consumer_reads_the_browser_locale_for_recognition():
    """navigator.language must not decide what the recognizer listens for."""
    for path in (_VOICE_HOOK_TS, _COMPOSER_TSX):
        src = open(path, encoding="utf-8").read()
        assert "navigator.language" not in src, (
            f"{os.path.basename(path)} torna a leggere navigator.language: "
            "l'esito di una sessione tornerebbe a dipendere dal locale del "
            "portatile, e i due consumatori condividono una sola sessione di "
            "riconoscimento, quindi l'ultimo che parte decide per entrambi."
        )


def test_both_consumers_share_one_pinned_language():
    for path in (_VOICE_HOOK_TS, _COMPOSER_TSX):
        src = open(path, encoding="utf-8").read()
        assert "SPEECH_LANG" in src, (
            f"{os.path.basename(path)} non usa piu' SPEECH_LANG: due lingue "
            "diverse sulla stessa istanza condivisa significano che quale "
            "delle due vale dipende dall'ordine di avvio."
        )


def test_every_command_has_a_spoken_form_in_both_languages():
    """The prompt tells the operator what to utter — it must have something to
    say for each command, in whichever language is pinned."""
    src = open(_REGISTRY_TS, encoding="utf-8").read()
    block = src[src.index("VOICE_KEYWORDS"):src.index("ITALIAN_FORMS")]
    for code, italian in (("YES", "sì"), ("DONE", "fatto"), ("PROCEED", "procedi")):
        assert code in block, f"comando {code} sparito dal vocabolario"
        assert italian in block, (
            f"la forma italiana '{italian}' di {code} non e' piu' nel "
            "vocabolario: con SPEECH_LANG=it-IT l'operatore non avrebbe nulla "
            "di pronunciabile da dire."
        )
