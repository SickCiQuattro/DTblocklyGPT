"""
Single source of truth for all Blockly block-type identifiers.

Every backend module that needs to parse Blockly JSON
(simulate.py, task.py, chat.py) must import from here
instead of defining its own local copies.

Keep in sync with the frontend definitions at:
  frontend/src/features/blockly/blocks/definitions.ts
  frontend/src/utils/blocklyParser.ts
"""

from enum import Enum


# ── Logic / Control Flow ───────────────────────────────────────────────────────

class LogicItems(Enum):
    REPEAT = "repeat_block"
    LOOP = "loop_block"
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


# ── Events / Conditions ────────────────────────────────────────────────────────

class EventsItems(Enum):
    FIND = "find_object_block"
    SENSOR = "sensor_signal_block"
    HUMAN = "human_feedback_block"
    TIMER = "timer_block"
    TOUCH = "touch_detect_block"
    GESTURE = "gesture_block"


# ── Library Entities (drag-and-drop references) ────────────────────────────────

class LibrariesItems(Enum):
    OBJECT = "object_block"
    ACTION = "action_block"
    LOCATION = "location_block"


# ── Macro Tasks ────────────────────────────────────────────────────────────────

class MacroItems(Enum):
    MACRO_TASK = "macro_task_block"


# ── Convenience: all step-level block types in one flat set ───────────────────

ALL_STEP_TYPES: set[str] = {e.value for e in StepsItems} | {e.value for e in LogicItems} | {MacroItems.MACRO_TASK.value}
