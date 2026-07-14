/**
 * toolboxRegistry.ts
 *
 * Static registry of toolbox categories and their block items.
 * This is the single source of truth for what appears in the custom
 * React toolbox sidebar. It is intentionally decoupled from Blockly's
 * runtime so the accordion can render independently of workspace lifecycle.
 */

import { blockDescriptionsByType, blocksColours } from '../blocks'

// ─── Types ───────────────────────────────────────────────────────────────────

/** Represents a single draggable block item inside a toolbox category. */
export interface ToolboxBlockItem {
  /** Blockly block type identifier (must match a registered block definition). */
  type: string
  /** Human-readable label shown on the pill. */
  label: string
  /** Pill background colour — defaults to the parent category colour. */
  colour: string
  /** Optional contextual help shown in the rich tooltip card. */
  description?: string
  /** Optional textual summary of accepted inputs shown in the rich tooltip card. */
  inputs?: string
  /** Optional textual summary of produced outputs shown in the rich tooltip card. */
  outputs?: string
  /**
   * If true, this block is "dynamic" — its instances are generated at runtime
   * from external data (objects, locations, actions). The toolbox will render
   * one pill per data item instead of a single static pill.
   */
  dynamic?: boolean
  /** Default field values to set when the block is created (static blocks only). */
  fields?: Record<string, string | number | boolean>
  /** Optional serialized metadata for block.data (used by entity mutators/tooltips). */
  data?: string
  /** Optional serialized macro source code used for expanded macro preview. */
  macroCode?: string
}

/** Represents a collapsible category in the toolbox accordion. */
export interface ToolboxCategory {
  /** Unique key used as the accordion panel identifier. */
  key: string
  /** Display name shown in the category header. */
  name: string
  /** Category accent colour (used for the header indicator and default pill colour). */
  colour: string
  /** Static block items in this category. */
  blocks: ToolboxBlockItem[]
}

// ─── Static Category Definitions ─────────────────────────────────────────────

export const TOOLBOX_CATEGORIES: ToolboxCategory[] = [
  {
    key: 'logic-control',
    name: 'Task Flow', // Logic / Control -> Program Flow -> Task Flow
    colour: blocksColours.logicControl,
    blocks: [
      {
        type: 'repeat_block',
        label: 'Repeat times', // Repeat N Times
        colour: blocksColours.logicControl,
        description: blockDescriptionsByType.repeat_block,
        inputs: 'Number of repetitions | Steps to repeat',
        outputs: 'None',
      },
      {
        type: 'repeat_until_block',
        label: 'Repeat until',
        colour: blocksColours.logicControl,
        description: blockDescriptionsByType.repeat_until_block,
        inputs: 'Condition to wait for | Steps to repeat',
        outputs: 'None',
      },
      {
        type: 'when_block',
        label: 'When → Do', // When … Do
        colour: blocksColours.logicControl,
        description: blockDescriptionsByType.when_block,
        inputs: 'Condition to check | Steps to run',
        outputs: 'None',
      },
      {
        type: 'when_otherwise_block',
        label: 'When → Do / Otherwise', // When … Do … Otherwise
        colour: blocksColours.logicControl,
        description: blockDescriptionsByType.when_otherwise_block,
        inputs: 'Event to check | First set of steps | Second set of steps',
        outputs: 'None',
      },
    ],
  },
  {
    key: 'robot-actions',
    name: 'Robot Actions', // Robot Actions -> Robot Movements
    colour: blocksColours.robotActions,
    blocks: [
      {
        type: 'pick_block',
        label: 'Pick up', // Pick
        colour: blocksColours.robotActions,
        description: blockDescriptionsByType.pick_block,
        inputs: 'Target object',
        outputs: 'None',
      },
      {
        type: 'processing_block',
        // MAPPING REFERENCE:
        // - Block type: 'processing_block' ➔ User-facing pill label: 'Execute skill'
        label: 'Execute skill',
        colour: blocksColours.robotActions,
        description: blockDescriptionsByType.processing_block,
        inputs: 'Skill to run',
        outputs: 'None',
      },
      {
        type: 'place_block',
        label: 'Place at', // Place
        colour: blocksColours.robotActions,
        description: blockDescriptionsByType.place_block,
        inputs: 'Target destination',
        outputs: 'None',
      },
      {
        type: 'move_to_block',
        label: 'Move to', // Move To
        colour: blocksColours.robotActions,
        description: blockDescriptionsByType.move_to_block,
        inputs: 'Motion type | Destination',
        outputs: 'None',
      },
      {
        type: 'open_gripper_block',
        label: 'Open Gripper',
        colour: blocksColours.robotActions,
        description: blockDescriptionsByType.open_gripper_block,
        outputs: 'None',
      },
      {
        type: 'close_gripper_block',
        label: 'Close Gripper',
        colour: blocksColours.robotActions,
        description: blockDescriptionsByType.close_gripper_block,
        outputs: 'None',
      },
      {
        type: 'wait_block',
        label: 'Wait',
        colour: blocksColours.robotActions,
        description: blockDescriptionsByType.wait_block,
        inputs: 'Duration (seconds)',
        outputs: 'None',
      },
    ],
  },
  {
    key: 'human-actions',
    name: 'Human Actions', // category for steps performed by the human operator at the cell
    colour: blocksColours.humanActions,
    blocks: [
      {
        type: 'human_action_block',
        label: 'Pause and show message', // Human Action -> Wait for Operator
        colour: blocksColours.humanActions,
        description: blockDescriptionsByType.human_action_block,
        inputs: 'Message to display | Condition to resume',
        outputs: 'None',
      },
      {
        type: 'notify_action_block',
        label: 'Show message',
        colour: blocksColours.humanActions,
        description: blockDescriptionsByType.notify_action_block,
        inputs: 'Message to display',
        outputs: 'None',
      },
    ],
  },
  {
    key: 'objects-positions',
    // MAPPING REFERENCE:
    // - Category key: 'objects-positions' ➔ User-facing accordion name: 'Library'
    name: 'Library',
    colour: blocksColours.objectsPositions,
    blocks: [
      // Dynamic blocks — pills are generated from props (dataObjects, dataLocations, dataActions).
      // Each entry here acts as a "template"; the actual pills are rendered per data item.
      {
        type: 'object_block',
        label: 'Objects', // Object
        colour: blocksColours.objectsPositions,
        dynamic: true,
      },
      {
        type: 'location_block',
        // MAPPING REFERENCE:
        // - Block type: 'location_block' ➔ User-facing label: 'Locations' (maps to spatial destinations)
        label: 'Locations',
        colour: blocksColours.objectsPositions,
        dynamic: true,
      },
      {
        type: 'action_block',
        // MAPPING REFERENCE:
        // - Block type: 'action_block' ➔ User-facing label: 'Skills' (replaces Routines/Procedures/Actions)
        label: 'Skills',
        colour: blocksColours.objectsPositions,
        dynamic: true,
      },
    ],
  },
  {
    key: 'events-conditions',
    name: 'Conditions', // Events / Conditions -> Sensors & Triggers
    colour: blocksColours.eventsConditions,
    blocks: [
      {
        type: 'find_object_block',
        label: 'Object detected', // Find Object
        colour: blocksColours.eventsConditions,
        description: blockDescriptionsByType.find_object_block,
        outputs: 'Yes or No',
        inputs: 'Object to look for',
      },
      {
        type: 'gesture_block',
        label: 'Gesture detected', // Gesture Detect
        colour: blocksColours.eventsConditions,
        description: blockDescriptionsByType.gesture_block,
        outputs: 'Yes or No',
        inputs: 'Type of gesture',
      },
      {
        type: 'voice_command_block',
        label: 'Voice command',
        colour: blocksColours.eventsConditions,
        description: blockDescriptionsByType.voice_command_block,
        outputs: 'Yes or No',
        inputs: 'Word to listen for',
      },
      // ── Hidden 2026-06-30 per relatrice feedback (kept for re-enable, not removed):
      //    timer 'Time passed' + logic AND/OR/NOT. Block definitions, parser and
      //    backend enums remain intact — only the toolbox pills are suppressed.
      // {
      //   type: 'timer_block',
      //   label: 'Time passed', // Timer
      //   colour: blocksColours.eventsConditions,
      //   description: blockDescriptionsByType.timer_block,
      //   inputs: 'Seconds',
      //   outputs: 'Yes or No',
      // },
      // {
      //   type: 'logic_and_block',
      //   label: 'AND',
      //   colour: blocksColours.eventsConditions,
      //   description: blockDescriptionsByType.logic_and_block,
      //   inputs: 'First condition | Second condition',
      //   outputs: 'Yes or No',
      // },
      // {
      //   type: 'logic_or_block',
      //   label: 'OR',
      //   colour: blocksColours.eventsConditions,
      //   description: blockDescriptionsByType.logic_or_block,
      //   inputs: 'First condition | Second condition',
      //   outputs: 'Yes or No',
      // },
      // {
      //   type: 'logic_not_block',
      //   label: 'NOT',
      //   colour: blocksColours.eventsConditions,
      //   description: blockDescriptionsByType.logic_not_block,
      //   inputs: 'Condition to reverse',
      //   outputs: 'Yes or No',
      // },
    ],
  },
  {
    key: 'macro-tasks',
    // MAPPING REFERENCE:
    // - Category key: 'macro-tasks' ➔ User-facing accordion name: 'Saved Tasks' (corresponds to nested task workflows)
    name: 'Saved Tasks',
    colour: blocksColours.macroTasks,
    blocks: [
      {
        type: 'macro_task_block',
        // MAPPING REFERENCE:
        // - Block type: 'macro_task_block' ➔ User-facing label: 'Saved Task'
        label: 'Saved Task',
        colour: blocksColours.macroTasks,
        dynamic: true,
      },
    ],
  },
]

/**
 * Flat type → { label, colour } lookup derived from TOOLBOX_CATEGORIES, so
 * any UI that needs to name/colour a block by its Blockly type (e.g. the
 * chat's proposed-task preview) can't drift from what the toolbox itself
 * shows — same pattern as blockDescriptionsByType.
 */
export const blockMetaByType: Record<
  string,
  { label: string; colour: string }
> = Object.fromEntries(
  TOOLBOX_CATEGORIES.flatMap((c) =>
    c.blocks.map((b) => [b.type, { label: b.label, colour: b.colour }]),
  ),
)
