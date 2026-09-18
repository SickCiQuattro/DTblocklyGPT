"""Regression tests for validate_step's step-type allow-list gaps (no server).

Run:
    poetry run python -m pytest testing/test_validate_step_gaps.py -v

Covers a real bug in the chat pipeline: `open_gripper`, `close_gripper`,
and `macro_task` are real, toolbox-reachable, fully-executed
Blockly block types (backend/block_types.py, definitions.ts, toolboxRegistry.ts,
blocklyParser.ts) that validate_step's dispatch had no branch for — they fell
into the "unknown step type" catch-all and were silently DROPPED as a warning
from any chat proposal that echoed them back from the task snapshot,
including steps the user built by hand and never asked to change.
"""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

try:
    import django
    django.setup()
except Exception:
    pass

from backend.functions.chat import validate_step


def _has_severity(warnings, severity):
    return any(w["severity"] == severity for w in warnings)


def test_open_gripper_step_is_not_dropped():
    warnings = []
    result = validate_step({"type": "open_gripper"}, 0, warnings, [], [], [])

    assert result is not None
    assert result["type"] == "open_gripper"
    assert not _has_severity(warnings, "error")
    assert not _has_severity(warnings, "warning")


def test_close_gripper_step_is_not_dropped():
    warnings = []
    result = validate_step({"type": "close_gripper"}, 0, warnings, [], [], [])

    assert result is not None
    assert result["type"] == "close_gripper"
    assert not _has_severity(warnings, "error")


# ─── macro_task: checked against the real catalogue ─────────────────────────
#
# Observed 2026-09-02, verbatim. The operator asked, in Italian, to append a
# saved task ("intendo il task da riutilizzare"); the assistant replied "Ho
# aggiunto l'esecuzione del task salvato 'dispose'" and appended a macro_task
# step for a saved task that does not exist.
#
# Two independent gaps, and each alone was enough:
#   * the prompt's # DATABASE # section listed objects, locations and actions,
#     and NOT saved tasks — while telling the model a "Saved Tasks" category
#     exists. The model was asked for something it had no data to answer.
#   * validate_step took no macro catalogue and could not have caught it. Its
#     own comment said so.

MACROS = [{"id": 42, "name": "Sort tubes by colour"}]


def test_a_saved_task_from_the_catalogue_survives():
    warnings = []
    step = {"type": "macro_task", "macroId": 42, "macroName": "Sort tubes by colour"}
    result = validate_step(step, 0, warnings, [], [], [], MACROS)

    assert result is not None
    assert result["macroId"] == 42
    assert not _has_severity(warnings, "error")
    assert not _has_severity(warnings, "warning")


def test_an_invented_saved_task_is_an_error_that_discards_the_proposal():
    """`error`, not `warning`, and the distinction is the whole point.

    Severity here decides whether the WHOLE proposal is thrown away
    (`is_valid` in new_message_multimodal). As a warning this step would be
    dropped silently and the rest applied — so the operator would accept a task
    that had quietly lost the step they actually asked for, while the reply
    said it was added. A macro is a whole sub-program; inventing one is worse
    than inventing an object.
    """
    warnings = []
    step = {"type": "macro_task", "macroId": 999, "macroName": "dispose"}
    validate_step(step, 0, warnings, [], [], [], MACROS)

    assert _has_severity(warnings, "error"), (
        "una Saved Task inventata non viene piu' segnalata come errore: la "
        "proposta verrebbe applicata senza lo step che l'utente ha chiesto, "
        "mentre la risposta dice che e' stato aggiunto."
    )


def test_a_stale_id_is_repinned_from_the_name():
    """The delete-and-recreate case, which fails at run time in front of the
    robot: `_h_macro` resolves by id, and a snapshot can carry an id from
    before the task was recreated. When the name matches the catalogue, the id
    is taken from the catalogue rather than echoed back."""
    warnings = []
    step = {"type": "macro_task", "macroId": 101, "macroName": "Sort tubes by colour"}
    result = validate_step(step, 0, warnings, [], [], [], MACROS)

    assert result["macroId"] == 42, "l'id non e' stato ripreso dal catalogo"
    assert not _has_severity(warnings, "error")


def test_an_unfilled_saved_task_slot_is_not_an_error():
    """A Saved Task block dropped on the canvas and not yet pointed at
    anything is the user's work in progress, echoed back from the snapshot.
    Same rule as every other unfilled slot: erroring here would discard the
    whole proposal every time someone asks a question with a half-built task
    on screen."""
    warnings = []
    result = validate_step({"type": "macro_task"}, 0, warnings, [], [], [], MACROS)

    assert result is not None
    assert not _has_severity(warnings, "error")


def test_unknown_step_type_is_still_dropped():
    """Regression guard the other way: a genuinely unrecognized type must
    still hit the catch-all and be dropped — the fix must not swallow real
    malformed-output detection."""
    warnings = []
    result = validate_step({"type": "not_a_real_block"}, 0, warnings, [], [], [])

    assert result is None
    assert _has_severity(warnings, "warning")
    assert not _has_severity(warnings, "error")


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-v"]))
