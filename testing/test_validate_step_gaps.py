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


def test_macro_task_step_with_id_is_not_dropped():
    warnings = []
    step = {"type": "macro_task", "macroId": 42, "macroName": "Sort tubes by colour"}
    result = validate_step(step, 0, warnings, [], [], [])

    assert result is not None
    assert result["type"] == "macro_task"
    assert result["macroId"] == 42
    assert not _has_severity(warnings, "error")
    assert not _has_severity(warnings, "warning")


def test_macro_task_step_without_id_warns_but_is_not_dropped():
    """No macro library is threaded into validate_step, so this is a light
    presence check only, not an existence check against real saved tasks."""
    warnings = []
    result = validate_step({"type": "macro_task"}, 0, warnings, [], [], [])

    assert result is not None
    assert not _has_severity(warnings, "error")
    assert _has_severity(warnings, "warning")


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
