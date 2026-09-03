"""What a task does to the world, summarised for a list view.

The task list shows names, statuses and dates — everything except the one thing
an operator standing next to the arm actually wants to know before opening a
program: does it move the real robot, does it wait for me, does it need the
camera. That is in the workspace, which the list endpoint deliberately does not
ship (the payload for 18 tasks would go from ~5 KB to hundreds).

So it is reduced here, server-side, to four booleans and a step count.

Computed from the PUBLISHED workspace when there is one, because that is what
running the task would execute; a draft-only task falls back to its draft, since
a card describing nothing would be worse than a card describing work in
progress. Same resolution order as task.py's `_resolve_runtime_workspace`, minus
the dead `code` column.
"""
from backend.block_types import (
    EventsItems,
    LogicItems,
    MacroItems,
    StepsItems,
)

# Blocks whose presence changes what the operator has to be ready for.
_GESTURE = EventsItems.GESTURE.value
_VOICE = EventsItems.VOICE.value
_FIND_OBJECT = EventsItems.FIND.value
_MACRO = MacroItems.MACRO_TASK.value

# Anything that commands motion. A program made only of waits and messages
# never moves the arm, and saying so is the point of the flag.
_MOTION_BLOCKS = {
    StepsItems.PICK.value,
    StepsItems.PLACE.value,
    StepsItems.MOVE_TO.value,
    StepsItems.PROCESSING.value,
    StepsItems.GRIPPER.value,
    StepsItems.OPEN_GRIPPER.value,
    StepsItems.CLOSE_GRIPPER.value,
}

# What counts as a step, by name rather than by structure.
#
# Structure cannot answer this: in a serialized Blockly workspace a statement
# input and a value input have the identical shape, `inputs: {NAME: {block:
# {...}}}`. So a walk that counts every node carrying a `type` counts the
# PARAMETERS too — the object a pick picks up, the location a place places at,
# the skill a processing step runs — plus every shadow placeholder sitting in
# an unfilled slot, plus the condition of a `when`.
#
# Measured on the checked-in database: a four-step task ("saved task, pick,
# processing, place") reported **7**, because its three parameter blocks were
# counted as steps. The card said "7 steps" about a program with four. An
# operator uses that number to judge how long a task will take before opening
# it, so it has to mean what it says.
#
# The `when_start` hat is excluded for the same reason `analisi.py` excludes
# it: it is the editor's start marker, not something the author put in the
# program. Counting it would make an empty program read as one step.
_STEP_BLOCKS = (
    {item.value for item in StepsItems}
    | {item.value for item in LogicItems}
    | {item.value for item in MacroItems}
)


def _walk_types(node, out: set) -> None:
    """Every `type` string anywhere in a serialized Blockly workspace.

    Structural, not schema-aware: blocks nest through `inputs`, `next`,
    `blocks` and statement inputs, so walking every value finds a block buried
    in a loop body inside a conditional exactly like a top-level one.
    """
    if isinstance(node, list):
        for child in node:
            _walk_types(child, out)
        return
    if not isinstance(node, dict):
        return
    block_type = node.get("type")
    if isinstance(block_type, str):
        out.add(block_type)
    for child in node.values():
        _walk_types(child, out)


def _count_blocks(node) -> int:
    """Steps in a workspace, counted at every nesting depth.

    Still structural about *where* it looks — a step inside a loop body inside
    a conditional counts exactly like a top-level one — but no longer
    structural about *what* counts. See `_STEP_BLOCKS`.
    """
    if isinstance(node, list):
        return sum(_count_blocks(child) for child in node)
    if not isinstance(node, dict):
        return 0
    total = 1 if node.get("type") in _STEP_BLOCKS else 0
    return total + sum(_count_blocks(child) for child in node.values())


def summarize_task(task) -> dict:
    """Compact description of what a task contains, for a list card.

    `movesRobot` is deliberately about the PROGRAM, not about the execution
    target: any task with a motion block moves the arm when run against
    hardware. Which target a given run uses is chosen at run time in the robot
    panel, and a card cannot know it.

    A task whose steps live inside a Saved Task reports the macro flag rather
    than the macro's contents: resolving nested macros here would mean a query
    per card. The card says "uses a saved task", which is honest, and the
    operator sees the real requirements in the robot panel before running.
    """
    workspace = task.published_workspace or task.draft_workspace or {}
    types: set = set()
    _walk_types(workspace, types)

    return {
        "steps": _count_blocks(workspace),
        "movesRobot": bool(types & _MOTION_BLOCKS),
        "needsCamera": _GESTURE in types or _FIND_OBJECT in types,
        "needsVoice": _VOICE in types,
        "usesSavedTask": _MACRO in types,
    }
