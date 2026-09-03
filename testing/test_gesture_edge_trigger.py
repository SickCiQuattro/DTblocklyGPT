"""Guard: a gesture must be GIVEN, not merely still present.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_gesture_edge_trigger.py -v

A gesture is a level, not an event: the browser reports what the hand is doing
right now, ten times a second. Voice and the confirm button have edge semantics
by construction — reset on entry, consume on read — so one utterance or one
press satisfies exactly one step. Gesture had none, and the freshness check in
_wait_for_condition cannot supply it: the age it reads is the age of the last
REPORT, and vision_live posts every frame including "NONE", so it sits at ~0
for as long as the webcam streams.

The consequence was invisible on a single confirm and fatal in a loop: a
repeat_until whose exit condition was a gesture ended after one iteration every
time, because the operator's hand had not moved since the previous step.
"""
import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

import django  # noqa: E402

django.setup()

from backend.functions import simulate  # noqa: E402


@pytest.fixture(autouse=True)
def _fast_and_quiet(monkeypatch):
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda *_a, **_k: None)
    yield
    simulate.SIMULATION_STOP_EVENT.clear()


def _bridge_reporting(sequence):
    """A bridge whose gesture follows `sequence`, holding the last value.

    age_s stays 0 throughout, which is what the real bridge reports while the
    webcam streams — the point being that freshness alone proves nothing.

    NOTE: the gesture branch calls get_vision_state() once before the wait loop,
    as a bridge-reachability probe, so sequence[0] is consumed there and the
    loop starts at sequence[1]. Sequences below are written accordingly.
    """
    bridge = MagicMock()
    state = {"i": 0}

    def vision_state():
        i = min(state["i"], len(sequence) - 1)
        state["i"] += 1
        return {"gesture": sequence[i], "detections": [], "gesture_age_s": 0.0}

    bridge.get_vision_state.side_effect = vision_state
    return bridge


GESTURE_BLOCK = {"type": "gesture_block", "fields": {"GESTURE_TYPE": "THUMBS_UP"}}


def test_a_gesture_already_held_at_entry_does_not_satisfy(monkeypatch):
    """The bug, stated as a test.

    The hand is showing THUMBS_UP from the moment the wait starts and never
    stops. That is a leftover, not an answer, and it must time out.
    """
    monkeypatch.setattr(simulate, "_bridge", _bridge_reporting(["THUMBS_UP"]))
    monkeypatch.setattr(simulate, "CONDITION_TIMEOUT_S", 0.6)

    assert simulate._wait_for_condition(GESTURE_BLOCK) is False


def test_a_gesture_given_after_the_prompt_satisfies(monkeypatch):
    """The normal case, and it must not get slower.

    The operator waits for the prompt, so the first polls see NONE; the
    transition requirement is met before they even raise their hand.
    """
    monkeypatch.setattr(
        simulate, "_bridge", _bridge_reporting(["NONE", "NONE", "THUMBS_UP"])
    )
    monkeypatch.setattr(simulate, "CONDITION_TIMEOUT_S", 5.0)

    assert simulate._wait_for_condition(GESTURE_BLOCK) is True


def test_releasing_and_repeating_satisfies_again(monkeypatch):
    """What makes repeat_until usable: a second answer on the same channel.

    Held, released, given again — the release is what turns the second showing
    into a new answer rather than the same one still lingering.
    """
    monkeypatch.setattr(
        simulate, "_bridge", _bridge_reporting(["THUMBS_UP", "NONE", "THUMBS_UP"])
    )
    monkeypatch.setattr(simulate, "CONDITION_TIMEOUT_S", 5.0)

    assert simulate._wait_for_condition(GESTURE_BLOCK) is True


def test_a_different_gesture_counts_as_the_release(monkeypatch):
    """Switching from one gesture to another is a transition too.

    Otherwise an operator correcting themselves — OK sign, then thumbs up —
    would be stuck waiting for a neutral hand in between. Here the thumb is
    also held at entry, so this covers the leftover case resolving through a
    different gesture rather than through an open hand.
    """
    monkeypatch.setattr(
        simulate, "_bridge", _bridge_reporting(["THUMBS_UP", "OK", "THUMBS_UP"])
    )
    monkeypatch.setattr(simulate, "CONDITION_TIMEOUT_S", 5.0)

    assert simulate._wait_for_condition(GESTURE_BLOCK) is True
