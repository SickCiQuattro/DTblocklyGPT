"""Guard on which shortcuts find_object is allowed to take.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_find_object_shortcuts.py -v

find_object can answer True without the camera agreeing, in a few situations
that each exist for a reason. One of them did not survive contact with a loop.

`_spawned_in_world` records what a pick spawned into Gazebo during this run.
Reading it here made the condition tautological inside repeat_until: the body
picks a blue tube, the exit test asks "blue tube detected", the name is in the
set, and the loop leaves after one iteration — every time, with the camera
never consulted. _h_repeat_until runs body, then exit test, then cleanup, so
the set still holds the body's object at the moment the test runs.

The bridge-unreachable shortcut stays: it is what keeps a run working with no
ROS vision stack at all (vision:=false), which is an ordinary development
setup. The study checklist requires the camera to be up, so removing only the
spawn shortcut takes nothing away from a real session.
"""
import os
import sys
from unittest.mock import MagicMock

import pytest
import requests

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

import django  # noqa: E402

django.setup()

from backend.block_types import EventsItems  # noqa: E402
from backend.functions import simulate  # noqa: E402

CONDITION = {
    "type": EventsItems.FIND.value,
    "inputs": {"OBJECT": {"block": {"data": '{"id": 1, "name": "blue tube"}'}}},
}


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None
    simulate._spawned_in_world.clear()
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda *_a, **_k: None)
    yield
    simulate._spawned_in_world.clear()
    simulate.SIMULATION_STOP_EVENT.clear()


def _blind_bridge():
    """Bridge that is reachable and sees nothing."""
    bridge = MagicMock()
    bridge.get_vision_state.return_value = {"gesture": "NONE", "detections": []}
    return bridge


def test_an_object_this_run_spawned_does_not_count_as_seen(monkeypatch):
    """The bug, stated as a test.

    The pick put "blue tube" into the world. That says where the robot put it,
    not what the camera can see, and a loop asking "is a blue tube detected"
    must not be answered by its own body's side effect.
    """
    monkeypatch.setattr(simulate, "_bridge", _blind_bridge())
    simulate._spawned_in_world.add("blue tube")

    assert simulate._wait_for_condition(CONDITION, timeout=0.4) is False


def test_an_unreachable_bridge_still_lets_the_run_continue(monkeypatch):
    """Kept on purpose: development without the ROS vision stack.

    With no bridge there is no camera to disagree with, and blocking every
    find_object would make the whole construct unusable outside a full rig.
    """
    bridge = MagicMock()
    bridge.get_vision_state.side_effect = requests.exceptions.ConnectionError()
    monkeypatch.setattr(simulate, "_bridge", bridge)
    monkeypatch.setattr(simulate, "STRICT_CONDITIONS", False)

    assert simulate._wait_for_condition(CONDITION, timeout=0.4) is True


def test_the_camera_still_decides_when_it_can_see(monkeypatch):
    bridge = MagicMock()
    bridge.get_vision_state.return_value = {
        "gesture": "NONE",
        "detections": [{"class": "bottle", "confidence": 0.9, "color": "blue"}],
    }
    monkeypatch.setattr(simulate, "_bridge", bridge)

    assert simulate._wait_for_condition(CONDITION, timeout=0.4) is True


def test_the_spawn_registry_is_still_used_for_cleanup():
    """The set stays — _h_pick reads it to remove a previous pick's entity
    before spawning the next one. Removing the find_object read must not have
    removed the registry."""
    source = open(
        os.path.join(os.path.dirname(__file__), "..", "backend", "functions", "simulate.py"),
        encoding="utf-8",
    ).read()
    assert "_spawned_in_world.add(" in source
    assert "if _spawned_in_world:" in source
