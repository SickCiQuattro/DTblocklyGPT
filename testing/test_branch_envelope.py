"""Guard on the branch-envelope shape the LLM echoes back from the snapshot.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_branch_envelope.py -v

The workspace snapshot sent to the model is built by `blocklyToAbstractAll`
(frontend/src/utils/blocklyParser.ts), which emits one *branch* envelope per
top-level stack — `{"isMain": bool, "steps": [...]}` — while the function schema
asks for `task` to be a flat array of AbstractStep. The prompt also instructs the
model to return the task field exactly matching the snapshot.

Doing as told therefore produced a top-level object with no "type", which
`validate_step` dropped as malformed; since the envelope is normally the only
top-level element, the whole program went with it and the user was told their
task had been updated while no proposal appeared. Captured live in the server
log, reproducibly, on any task with content:

    validate_step dropped step 0: a step with no type.
    Raw step: {"isMain": true, "steps": [{"type": "when", ...}]}

These fixtures are that exact payload.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

try:
    import django
    django.setup()
except Exception:
    pass

from backend.functions.chat import is_unfilled_slot, unwrap_branch_envelopes


def test_unwraps_the_shape_captured_in_the_log():
    task = [
        {
            "isMain": True,
            "steps": [
                {
                    "type": "when",
                    "condition": {"type": "find_object", "objectId": 25, "objectName": "green tube"},
                    "do": [
                        {"type": "pick", "objectId": 25, "objectName": "green tube"},
                        {"type": "place", "locationId": 1, "locationName": "collection rack"},
                    ],
                }
            ],
        }
    ]
    assert unwrap_branch_envelopes(task) == task[0]["steps"]


def test_flat_task_passes_through_unchanged():
    """The well-formed shape must not be disturbed — same object, not a copy."""
    task = [
        {"type": "pick", "objectId": 22, "objectName": "tube"},
        {"type": "place", "locationId": 11, "locationName": "tube rack"},
    ]
    assert unwrap_branch_envelopes(task) is task


def test_keeps_every_branch_not_just_the_main_one():
    """Non-main branches are the user's disconnected stacks: dropping them
    would delete work they can see on the canvas."""
    task = [
        {"isMain": True, "steps": [{"type": "pick", "objectId": 1, "objectName": "a"}]},
        {"isMain": False, "steps": [{"type": "wait", "seconds": 3}]},
    ]
    assert unwrap_branch_envelopes(task) == [
        {"type": "pick", "objectId": 1, "objectName": "a"},
        {"type": "wait", "seconds": 3},
    ]


def test_a_step_that_owns_a_steps_array_is_not_an_envelope():
    """`repeat` carries its own "steps" — it must never be flattened away.

    This is the failure mode the fix could plausibly introduce: unwrapping on
    the presence of "steps" alone would tear a loop's body out of the loop and
    splice it into the top level, silently changing what the program does.
    Having a "type" is what separates a real step from an envelope.
    """
    task = [
        {
            "type": "repeat",
            "times": 2,
            "steps": [{"type": "pick", "objectId": 22, "objectName": "tube"}],
        }
    ]
    assert unwrap_branch_envelopes(task) is task


def test_mixed_shapes_survive_together():
    task = [
        {"isMain": True, "steps": [{"type": "pick", "objectId": 1, "objectName": "a"}]},
        {"type": "place", "locationId": 2, "locationName": "b"},
    ]
    assert unwrap_branch_envelopes(task) == [
        {"type": "pick", "objectId": 1, "objectName": "a"},
        {"type": "place", "locationId": 2, "locationName": "b"},
    ]


def test_non_list_input_is_returned_untouched():
    assert unwrap_branch_envelopes(None) is None
    assert unwrap_branch_envelopes({"type": "pick"}) == {"type": "pick"}


# ─── Unfilled slots ──────────────────────────────────────────────────────────
#
# The second half of the same story. Once the envelope was unwrapped, proposals
# appeared — and then a task with any empty slot produced:
#
#     Pick step 0.when.do[0]: object 'Select Object...' not found.
#
# at ERROR severity, which discards the entire proposal. A block dropped on the
# canvas starts with a placeholder and a null id; that is the normal state of a
# task under construction, it goes into the snapshot verbatim, and the model
# echoes it back whenever it answers without changing that step — for instance
# when asking which object to use. The user's unfinished work was being read as
# a malformed model output.

def test_null_id_with_placeholder_label_is_unfilled():
    assert is_unfilled_slot(None, "Select Object...") is True
    assert is_unfilled_slot(None, "Select Location") is True
    assert is_unfilled_slot(None, "Select Skill") is True


def test_null_id_with_no_name_is_unfilled():
    assert is_unfilled_slot(None, None) is True
    assert is_unfilled_slot(None, "") is True


def test_a_real_id_is_never_an_unfilled_slot():
    """Even id 0 counts as filled — `is not None`, not truthiness."""
    assert is_unfilled_slot(22, "tube") is False
    assert is_unfilled_slot(0, "tube") is False


def test_a_named_but_unknown_entity_stays_an_error():
    """The distinction that matters: a hallucinated entity is a real fault and
    must keep discarding the proposal, unlike an empty slot."""
    assert is_unfilled_slot(None, "purple centrifuge") is False


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
