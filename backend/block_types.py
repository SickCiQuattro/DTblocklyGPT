"""
Single source of truth for all Blockly block-type identifiers.

Every backend module that DISPATCHES on a block type — simulate.py's and
task.py's recursive parsers — imports from here rather than repeating the
string. That is what makes a rename a one-line change instead of a hunt.

Two places deliberately keep literals, and neither dispatches on them:
  - the management commands under `management/commands/`, which build fixture
    workspaces where the literal reads as the data it is;
  - `chat.py`'s prompt, which is prose sent to a model.

The file did not always cover what it claimed. `logic_and/or/not` were live
block types — emitted by the chat assistant, evaluated by both parsers — with
no entry here at all, so the one file a rename is supposed to be checked
against was missing exactly the three types most likely to be overlooked.

Keep in sync with the frontend definitions at:
  frontend/src/features/blockly/blocks/definitions.ts
  frontend/src/utils/blocklyParser.ts
"""

from enum import Enum


# ── Logic / Control Flow ───────────────────────────────────────────────────────

class LogicItems(Enum):
    REPEAT = "repeat_block"
    REPEAT_UNTIL = "repeat_until_block"
    WHEN_OTHERWISE = "when_otherwise_block"
    WHEN = "when_block"


# ── Robot Step Actions ─────────────────────────────────────────────────────────

class StepsItems(Enum):
    PICK = "pick_block"
    PROCESSING = "processing_block"
    PLACE = "place_block"
    HUMAN_ACTION = "human_action_block"
    NOTIFY_ACTION = "notify_action_block"
    MOVE_TO = "move_to_block"
    GRIPPER = "gripper_block"
    OPEN_GRIPPER = "open_gripper_block"
    CLOSE_GRIPPER = "close_gripper_block"
    WAIT = "wait_block"


# ── Events / Conditions ────────────────────────────────────────────────────────

class EventsItems(Enum):
    FIND = "find_object_block"
    TIMER = "timer_block"
    GESTURE = "gesture_block"
    VOICE = "voice_command_block"
    HUMAN_FEEDBACK = "human_feedback_block"


# ── Library Entities (drag-and-drop references) ────────────────────────────────

class LibrariesItems(Enum):
    OBJECT = "object_block"
    ACTION = "action_block"
    LOCATION = "location_block"


# ── Boolean Operators (combine conditions, never steps) ───────────────────────

# Kept out of LogicItems: those are control-flow *steps*, these are operands of
# a condition slot. They are hidden from the toolbox and the shadow picker (see
# toolboxRegistry.ts) but the chat assistant still emits them and both parsers
# still evaluate them, so they are live block types — they were simply missing
# from this file, which is the one place a rename is supposed to be caught.
class BooleanItems(Enum):
    AND = "logic_and_block"
    OR = "logic_or_block"
    NOT = "logic_not_block"


# ── Macro Tasks ────────────────────────────────────────────────────────────────

class MacroItems(Enum):
    MACRO_TASK = "macro_task_block"


# ── Workspace Root ─────────────────────────────────────────────────────────────

# The "When task starts" hat. Not a step: the parsers skip it and continue with
# its `next`, and the seed commands emit it as the root of every workspace.
WHEN_START = "when_start"
