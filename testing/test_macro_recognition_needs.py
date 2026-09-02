"""Guard: a run must acquire the camera/mic for steps hidden inside Saved Tasks.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_macro_recognition_needs.py -v

The webcam and microphone are started BEFORE a run, not when the waiting step is
reached — acquiring a webcam takes long enough that a gesture step beginning at
t=0 of the acquisition sends no frames at all. So the panel decides in advance,
from the program, which channels it needs.

It used to decide from the blocks on the canvas. A Saved Task's steps live in
another task's workspace, so a task whose only gesture step sits inside a macro
reported "needs nothing": the webcam never started and the step waited its full
timeout while the operator gestured at a camera that was off. Voice the same.
Reported from the physical cell 2026-09-01.

No JS test runner here (same constraint as test_block_delete_paths.py), so this
parses the TypeScript and checks the property that broke: the decision follows
macros, and the panel asks that function rather than scanning the canvas itself.
"""
import os
import re

FRONTEND = os.path.join(os.path.dirname(__file__), "..", "frontend", "src")
NEEDS = os.path.join(FRONTEND, "utils", "runRecognitionNeeds.ts")
PANEL = os.path.join(FRONTEND, "components", "DigitalTwinPanel.tsx")


def _read(path: str) -> str:
    return open(path, encoding="utf-8").read()


def test_the_needs_helper_resolves_macros():
    src = _read(NEEDS)
    assert "macro_task_block" in src, (
        "il calcolo dei canali non riconosce piu' i blocchi Saved Task: torna a "
        "vedere solo il canvas, e una gesture dentro una macro non accende la camera."
    )
    assert "getMacroIdFromBlockData" in src, "non legge piu' l'id della macro"


def test_it_guards_against_a_macro_cycle():
    """Publishing does not reject a macro that references itself — CLAUDE.md
    records the cycle check as scaffolded and never wired up — so the walk has
    to carry its own guard or it recurses forever."""
    src = _read(NEEDS)
    assert "seen" in src and "seen.has(" in src, (
        "la visita delle macro non ha piu' una guardia sui cicli"
    )


def test_it_follows_nested_saved_tasks():
    src = _read(NEEDS)
    assert "collectMacroIds" in src, (
        "una macro dentro una macro non viene piu' seguita: la gesture nel "
        "secondo livello tornerebbe invisibile."
    )


def test_find_object_does_not_request_a_browser_camera():
    """find_object reads the robot's camera through vision_node. Asking the
    operator for webcam permission because of it would prompt for a device the
    step never uses."""
    src = _read(NEEDS)
    camera_line = re.search(r"camera: ([^\n]+)", src)
    assert camera_line, "il campo camera e' sparito"
    assert "find_object" not in camera_line.group(1)


def test_the_panel_asks_the_helper_instead_of_scanning_the_canvas():
    src = _read(PANEL)
    assert "recognitionNeedsOf" in src, "il pannello non usa piu' il calcolo condiviso"
    # The exact scan that produced the bug, in any of its three former places.
    offenders = re.findall(
        r"getAllBlocks\(false\)[\s\S]{0,120}?"
        r"(?:gesture_block|voice_command_block|human_feedback_block)",
        src,
    )
    assert not offenders, (
        "il pannello e' tornato a decidere dai blocchi sul canvas: e' esattamente "
        "il calcolo che ignora i passi dentro una Saved Task."
    )
