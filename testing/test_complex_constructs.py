"""Regression tests for repeat/repeat-until/AND-OR-NOT/macro-nesting
(offline, no Gazebo/ROS/DB).

Run:
    poetry run python -m pytest testing/test_complex_constructs.py -v

Three real defects, same "crash-into-silent-truncation" or "ambiguous-guard"
classes already fixed for `when`/`when_otherwise`:

1. `_h_repeat` indexed `code["fields"]["times"]` unguarded (unlike its
   sibling `_h_wait`, which already used `.get(..., default)`) — a
   malformed/missing `times` field raised KeyError, swallowed by the
   parser's blanket `except Exception`, truncating the rest of the chain.
2. `_h_repeat_until` treated a missing/unattached CONDITION as *trivially
   satisfied after one iteration* (`_fulfilled = True`), running its DO
   exactly once with no real guard — the opposite of `_h_when`'s rule that
   an ambiguous/incomplete condition must never let a robot action run.
   `condition: null` passes `chat.py`'s `validate_condition` gate the same
   way it does for `when`, so this was reachable from a real proposal.
3. Macro recursion had no depth/cycle guard — `_h_macro` calling
   `simulation_recursive_blockly_parser` on itself indefinitely (a macro
   cycle A→B→A, creatable from the UI since no DAG cycle detection exists
   at publish time) would run until Python's own RecursionError, caught by
   the same blanket `except Exception` and silently truncating the task.

Also covers `_eval_condition_tree` (AND/OR/NOT, nestable, used by both
`when` and `repeat_until`) which had zero test coverage despite being fully
wired end-to-end for the documented chat-only path (AND/OR/NOT are hidden
from the Blockly palette but the LLM can still emit them).
"""
import json
import sys
import os
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

try:
    import django
    django.setup()
except Exception:
    pass

from backend.functions import simulate


@pytest.fixture(autouse=True)
def _reset_state():
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None
    yield
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate._TASK_ABORT_REASON = None


def _notify_action(description):
    return {"type": "notify_action_block", "fields": {"TASK_DESC": description}}


# ─── _h_repeat: missing/malformed 'times' ──────────────────────────────────

def test_repeat_with_missing_times_field_skips_loop_and_continues_chain(monkeypatch):
    mock_bridge = MagicMock()
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)

    code = {
        "type": "repeat_block",
        "fields": {},  # 'times' missing entirely
        "inputs": {"DO": {"block": _notify_action("should not run")}},
        "next": {"block": _notify_action("after the repeat")},
    }

    simulate.simulation_recursive_blockly_parser(code, [], [], [], simulate_event=True)

    assert not simulate.SIMULATION_STOP_EVENT.is_set()
    calls = [c.args[1].get("description") for c in mock_bridge.notify.call_args_list]
    assert "should not run" not in calls
    assert "after the repeat" in calls


def test_repeat_with_non_numeric_times_field_does_not_crash(monkeypatch):
    mock_bridge = MagicMock()
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)

    code = {
        "type": "repeat_block",
        "fields": {"times": "not-a-number"},
        "inputs": {"DO": {"block": _notify_action("should not run")}},
        "next": {"block": _notify_action("after the repeat")},
    }

    simulate.simulation_recursive_blockly_parser(code, [], [], [], simulate_event=True)

    assert not simulate.SIMULATION_STOP_EVENT.is_set()
    mock_bridge.notify.assert_any_call("/api/notify", {"description": "after the repeat"})


# ─── _h_repeat_until: unattached CONDITION ─────────────────────────────────

def test_repeat_until_with_unattached_condition_skips_loop_entirely(monkeypatch):
    """Regression: previously ran DO once unconditionally (_fulfilled = True
    after the first iteration) — the opposite of when's "no condition = never
    run" rule for the same reachable case."""
    mock_bridge = MagicMock()
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)

    code = {
        "type": "repeat_until_block",
        "inputs": {
            "CONDITION": {},
            "DO": {"block": _notify_action("should not run")},
        },
        "next": {"block": _notify_action("after the repeat-until")},
    }

    simulate.simulation_recursive_blockly_parser(code, [], [], [], simulate_event=True)

    assert not simulate.SIMULATION_STOP_EVENT.is_set()
    calls = [c.args[1].get("description") for c in mock_bridge.notify.call_args_list]
    assert "should not run" not in calls
    assert "after the repeat-until" in calls


# ─── _eval_condition_tree: AND/OR/NOT, previously zero coverage ───────────

def _gesture(gesture_type="THUMBS_UP"):
    return {"type": "gesture_block", "fields": {"GESTURE_TYPE": gesture_type}}


@pytest.mark.parametrize(
    "tree_builder,expected",
    [
        (lambda: {"type": "logic_and_block", "inputs": {
            "A": {"block": {"type": "human_feedback_block"}},
            "B": {"block": {"type": "human_feedback_block"}},
        }}, True),
        (lambda: {"type": "logic_not_block", "inputs": {
            "BOOL": {"block": {"type": "human_feedback_block"}},
        }}, False),
        (lambda: {"type": "logic_or_block", "inputs": {
            "A": {"block": {"type": "logic_not_block", "inputs": {
                "BOOL": {"block": {"type": "human_feedback_block"}},
            }}},
            "B": {"block": {"type": "human_feedback_block"}},
        }}, True),
    ],
    ids=["and-true-true", "not-true-is-false", "nested-or-not-and-leaf"],
)
def test_eval_condition_tree_handles_nested_and_or_not(monkeypatch, tree_builder, expected):
    # simulate_event=True routes every leaf through _log_condition, which for
    # human_feedback_block just reflects simulate_event (True) — isolates the
    # AND/OR/NOT routing logic itself from any real wait/hardware behaviour.
    result = simulate._eval_condition_tree(tree_builder(), simulate_event=True)
    assert result is expected


def test_eval_condition_tree_none_block_is_never_satisfied():
    # Regression: this used to return True for a bare `None` block
    # ("vacuously satisfied"), which was safe only because
    # the top-level callers (when/repeat_until) already guard "no condition
    # attached" before ever calling this function. But logic_and/or/not
    # recurse into THIS function for each operand — an empty A/B/BOOL slot
    # reaches this exact base case one level down, where the old `True`
    # let an incomplete AND/OR/NOT guard look satisfied and run a robot
    # action anyway. `False` is correct at every call depth, not just the
    # ones already guarded by a caller.
    assert simulate._eval_condition_tree(None, simulate_event=True) is False


@pytest.mark.parametrize(
    "tree_builder",
    [
        lambda: {"type": "logic_and_block", "inputs": {
            "A": {},  # empty slot, never filled in
            "B": {"block": {"type": "human_feedback_block"}},
        }},
        lambda: {"type": "logic_and_block", "inputs": {
            "A": {"block": {"type": "human_feedback_block"}},
            "B": {},
        }},
        lambda: {"type": "logic_or_block", "inputs": {
            "A": {},
            "B": {"block": {"type": "human_feedback_block"}},
        }},
        lambda: {"type": "logic_not_block", "inputs": {"BOOL": {}}},
    ],
    ids=["and-a-empty", "and-b-empty", "or-a-empty-b-true", "not-empty"],
)
def test_eval_condition_tree_empty_operand_never_satisfied(tree_builder):
    """AND/OR/NOT must never look satisfied because one operand is an
    unfilled shadow slot — not even OR, where the other operand alone
    evaluates True, and not even NOT, which would otherwise turn an absence
    into `not False = True`."""
    result = simulate._eval_condition_tree(tree_builder(), simulate_event=True)
    assert result is False


# ─── Macro recursion: cycle A→B→A must abort, not RecursionError ─────────

class _FakeMacroTask:
    def __init__(self, code_dict):
        self.code = json.dumps(code_dict)


class _FakeQuerySet:
    def __init__(self, task):
        self._task = task

    def first(self):
        return self._task


class _FakeTaskManager:
    def __init__(self, tasks_by_id):
        self._tasks = tasks_by_id

    def filter(self, *args, id=None, **kwargs):
        # *args absorbs the Q(owner=...) | Q(shared=True) visibility filter
        # _h_macro now passes positionally alongside id= — this fake doesn't
        # evaluate Q objects, it only needs to not collide with them.
        return _FakeQuerySet(self._tasks.get(id))


class _FakeTaskModel:
    def __init__(self, tasks_by_id):
        self.objects = _FakeTaskManager(tasks_by_id)


def _macro_call(task_id, name):
    return {"type": "macro_task_block", "data": json.dumps({"id": task_id, "name": name})}


def test_macro_cycle_aborts_at_depth_cap_instead_of_recursion_error(monkeypatch):
    mock_bridge = MagicMock()
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)
    monkeypatch.setattr(simulate, "MAX_MACRO_DEPTH", 3)

    # Task 1 ("A") calls Task 2 ("B"); Task 2 ("B") calls Task 1 ("A") — a
    # circular macro dependency, creatable from the UI today since no DAG
    # cycle detection exists at publish time.
    tasks_by_id = {
        1: _FakeMacroTask(_macro_call(2, "B")),
        2: _FakeMacroTask(_macro_call(1, "A")),
    }
    monkeypatch.setattr(simulate, "Task", _FakeTaskModel(tasks_by_id))

    entry_code = _macro_call(1, "A")

    simulate.simulation_recursive_blockly_parser(entry_code, [], [], [], simulate_event=True)

    assert simulate.SIMULATION_STOP_EVENT.is_set()
    assert simulate._TASK_ABORT_REASON is not None
    assert "too many nested saved tasks" in simulate._TASK_ABORT_REASON
    mock_bridge.stop.assert_called()


def test_macro_nesting_within_depth_cap_runs_to_completion(monkeypatch):
    """Non-cyclic nesting (A calls B, B has real steps, no cycle) must not be
    penalized by the new depth guard."""
    mock_bridge = MagicMock()
    monkeypatch.setattr(simulate, "_bridge", mock_bridge)
    monkeypatch.setattr(simulate, "MAX_MACRO_DEPTH", 3)

    inner_task = _FakeMacroTask({"type": "notify_action_block", "fields": {"TASK_DESC": "inner step"}})
    tasks_by_id = {1: inner_task}
    monkeypatch.setattr(simulate, "Task", _FakeTaskModel(tasks_by_id))

    entry_code = _macro_call(1, "A")

    simulate.simulation_recursive_blockly_parser(entry_code, [], [], [], simulate_event=True)

    assert not simulate.SIMULATION_STOP_EVENT.is_set()
    assert simulate._TASK_ABORT_REASON is None
    mock_bridge.notify.assert_any_call("/api/notify", {"description": "inner step"})


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
