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
    """A macro row shaped the way real rows are shaped.

    This used to set only `.code` — the legacy column — which is what let the
    macro handler read `.code` unnoticed for as long as it did: the fixture was
    the only place in the system where that column ever held anything. Nothing
    has written it since the lifecycle migration (`publish_task` writes
    `published_workspace`), so every Saved Task block silently ran nothing while
    reporting "Macro complete".

    `code = None` is deliberate, not an omission: it is what the database
    actually contains, and it keeps this test honest about which field the
    runtime is allowed to depend on.
    """

    def __init__(self, code_dict):
        self.task_type = "macro_task"
        self.published_workspace = code_dict
        self.draft_workspace = None
        self.workspace = None
        self.code = None


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


# ─── Macro read path: published_workspace, never the legacy `code` column ────


def test_macro_runs_its_published_workspace(monkeypatch):
    """The shape every real row has: `code` empty, `published_workspace` set.

    Before this, the handler read `Task.code`, which no code path has written
    since the lifecycle migration. Every Saved Task block therefore resolved to
    nothing, skipped its entire sub-program, printed "Macro complete" and let
    the run report success — a whole branch of the operator's program silently
    not executing while the system said it had.
    """
    executed = []
    monkeypatch.setattr(simulate, "MAX_MACRO_DEPTH", 3)
    monkeypatch.setattr(
        simulate, "_h_pick_recorder", None, raising=False
    )

    inner = {"type": "wait_block", "fields": {"SECONDS": 0}}
    tasks_by_id = {7: _FakeMacroTask(inner)}
    monkeypatch.setattr(simulate.Task, "objects", _FakeTaskManager(tasks_by_id))
    monkeypatch.setattr(
        simulate, "_interruptible_sleep", lambda s: executed.append(("wait", s))
    )

    simulate._TASK_ABORT_REASON = None
    simulate.simulation_recursive_blockly_parser(
        _macro_call(7, "Sotto-programma"), [], [], [], True, False, 0
    )

    assert executed, "il corpo del macro non è stato eseguito"
    assert simulate._TASK_ABORT_REASON is None


def test_macro_published_as_a_list_of_blocks_runs(monkeypatch):
    """The shape `publish_task` actually stores: a LIST of top-level blocks.

    `getBlocklyStructure()` returns `.blocks.blocks`, a flat array, and that is
    what reaches `published_workspace`. `simulate_task` unwraps that list before
    calling the parser; the macro handler did not, so every real macro run died
    on `code["type"]` with "list indices must be integers, not str" — while the
    log still printed "Macro complete".

    The sibling test above passes a single dict and therefore never touched this
    path: the fixture, not the runtime, was what made the old shape look
    supported. Two blocks here, so a handler that unwrapped only the first would
    still fail.
    """
    executed = []
    monkeypatch.setattr(simulate, "MAX_MACRO_DEPTH", 3)

    published_as_list = [
        {"type": "wait_block", "fields": {"SECONDS": 1}},
        {"type": "wait_block", "fields": {"SECONDS": 2}},
    ]
    tasks_by_id = {9: _FakeMacroTask(published_as_list)}
    monkeypatch.setattr(simulate.Task, "objects", _FakeTaskManager(tasks_by_id))
    monkeypatch.setattr(
        simulate, "_interruptible_sleep", lambda s: executed.append(s)
    )

    simulate._TASK_ABORT_REASON = None
    simulate.SIMULATION_STOP_EVENT.clear()
    simulate.simulation_recursive_blockly_parser(
        _macro_call(9, "Lista"), [], [], [], True, False, 0
    )

    assert simulate._TASK_ABORT_REASON is None, simulate._TASK_ABORT_REASON
    assert executed == [1, 2], f"attesi entrambi i blocchi, eseguito {executed}"


def test_macro_reports_step_progress_not_a_percentage(monkeypatch):
    """A running Saved Task announces "step N of M" on its own block.

    Its inner blocks belong to another task's workspace and never appear on the
    canvas, so the macro block is the only thing the operator can see while the
    sub-program runs — hence the progress rides on that block's own id.

    Asserted as counts, never a fraction: the total is a count of TOP-LEVEL
    blocks, and a macro containing `repeat 5 times` executes far more steps than
    it contains. A percentage derived from this denominator would be wrong the
    moment a loop appears, which is exactly the kind of confidently-false
    readout this codebase keeps having to remove.
    """
    events = []
    monkeypatch.setattr(simulate, "MAX_MACRO_DEPTH", 3)
    monkeypatch.setattr(
        simulate, "_notify_block_step",
        lambda block_id, block_type, phase, **extra: events.append((phase, extra)),
    )

    # The shape Blockly actually stores: ONE top-level block, the rest chained
    # through `next`, behind a `when_start` marker. Counting the top-level
    # entries instead of the chain reported "step 1 of 1" for this very macro.
    published = [
        {
            "type": "when_start",
            "next": {"block": {
                "type": "wait_block", "fields": {"SECONDS": 1},
                "next": {"block": {
                    "type": "wait_block", "fields": {"SECONDS": 2},
                    "next": {"block": {"type": "wait_block", "fields": {"SECONDS": 3}}},
                }},
            }},
        }
    ]
    monkeypatch.setattr(
        simulate.Task, "objects", _FakeTaskManager({4: _FakeMacroTask(published)})
    )
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)

    simulate._TASK_ABORT_REASON = None
    simulate.SIMULATION_STOP_EVENT.clear()
    # `id` matters: the progress rides on the macro block's own id, and
    # _h_macro skips the notify when there is none. Real workspaces always carry
    # one; _macro_call omits it, which is why this passes it explicitly.
    call = {**_macro_call(4, "Sotto-compito"), "id": "macro-block-1"}
    simulate.simulation_recursive_blockly_parser(
        call, [], [], [], True, False, 0
    )

    progress = [e for _, e in events if "macroStep" in e]
    assert [e["macroStep"] for e in progress] == [1, 2, 3]
    assert {e["macroTotal"] for e in progress} == {3}
    assert {e["macroName"] for e in progress} == {"Sotto-compito"}


def test_macro_closes_before_the_blocks_that_follow_it(monkeypatch):
    """The macro's "end" must precede the next block's "start".

    Every handler calls _next() from inside itself, so the rest of the program
    runs nested within the macro's own call and the parser's wrapper does not
    emit the macro's "end" until the entire run is over. That is invisible for
    an ordinary block — the next "start" replaces its highlight — but the
    frontend deliberately pins both the highlight and the STATUS line to a
    running Saved Task so its inner blocks cannot steal them. Without an
    explicit close the run ended with the macro still lit and the status frozen
    on its final step.
    """
    seq = []
    monkeypatch.setattr(simulate, "MAX_MACRO_DEPTH", 3)
    monkeypatch.setattr(
        simulate, "_notify_block_step",
        lambda block_id, block_type, phase, **extra: seq.append((phase, block_type)),
    )
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)

    # Inner blocks carry ids, as real ones do. Without them `emit_highlight`
    # is false for the id alone and the assertion below passes whatever the
    # depth guard does — the fixture, not the runtime, would be under test.
    published = [
        {"type": "wait_block", "id": "inner-1", "fields": {"SECONDS": 1}}
    ]
    monkeypatch.setattr(
        simulate.Task, "objects", _FakeTaskManager({8: _FakeMacroTask(published)})
    )

    simulate._TASK_ABORT_REASON = None
    simulate.SIMULATION_STOP_EVENT.clear()
    call = {
        **_macro_call(8, "Sotto"), "id": "macro-1",
        "next": {"block": {"type": "wait_block", "id": "after-1",
                           "fields": {"SECONDS": 2}}},
    }
    simulate.simulation_recursive_blockly_parser(call, [], [], [], True, False, 0)

    macro_end = seq.index(("end", "macro_task_block"))
    following = seq.index(("start", "wait_block"), macro_end)
    assert macro_end < following, seq

    # One 'end' per block ON THE CANVAS — the macro and the block after it.
    # The macro's inner blocks emit nothing (their ids are not on this canvas)
    # and the macro emits exactly one end, not two. Before this, the run-wide
    # "N done" counter advanced by five for a canvas holding two blocks.
    assert [t for p, t in seq if p == "end"] == [
        "macro_task_block",
        "wait_block",
    ], seq


def test_macro_without_a_published_version_aborts(monkeypatch):
    """Skipping it would report success for a program that did less than it says.

    Same reasoning as the pick/place gates: a step the operator deliberately
    placed must either run or stop the task, never quietly do nothing.
    """
    monkeypatch.setattr(simulate, "MAX_MACRO_DEPTH", 3)
    unpublished = _FakeMacroTask({"type": "wait_block", "fields": {"SECONDS": 0}})
    unpublished.published_workspace = None
    monkeypatch.setattr(simulate.Task, "objects", _FakeTaskManager({8: unpublished}))

    simulate._TASK_ABORT_REASON = None
    simulate.SIMULATION_STOP_EVENT.clear()
    try:
        simulate.simulation_recursive_blockly_parser(
            _macro_call(8, "Mai pubblicato"), [], [], [], True, False, 0
        )
        assert simulate._TASK_ABORT_REASON is not None, "doveva abortire"
        assert "Mai pubblicato" in simulate._TASK_ABORT_REASON
    finally:
        simulate._TASK_ABORT_REASON = None
        simulate.SIMULATION_STOP_EVENT.clear()
