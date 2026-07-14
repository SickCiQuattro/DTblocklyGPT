/**
 * definitions.ts
 *
 * Registers all Blockly block types used in the robot-task editor.
 * Block types are grouped by their semantic role:
 *
 *  1. Entity blocks   — object, location, action (user-defined data)
 *  2. Conditions      — sensor, find-object, touch, gesture, timer, logic
 *  3. Robot actions   — pick, place, move, gripper, wait, perform
 *  4. Human steps     — pause-and-show, show-message
 *  5. Task flow       — repeat, loop, repeat-until, when, when/otherwise
 *  6. Macro tasks     — reference to a saved sub-task
 *  7. Entry point     — when_start (mandatory program start block)
 *  8. Shadow blocks   — placeholder "+" blocks for empty connection slots
 *
 * This module is imported for its side-effects only: every `defineBlocksWithJsonArray`
 * and `Extensions.register` call registers types globally in Blockly's runtime.
 */

import * as Blockly from 'blockly/core'

import { blockDescriptionsByType } from './blockTextDictionary'
import { blocksColours } from './palette'
import {
  REPEAT2_ICON_URI,
  BOT_ICON_URI,
  FLAG_ICON_URI,
  MAP_PIN_ICON_URI,
  SCAN_EYE_ICON_URI,
  MIC_ICON_URI,
  TAG_ICON_URI,
  BOX_ICON_URI,
  ZAP_ICON_URI,
  SPLIT_ICON_URI,
  CLOCK_ICON_URI,
  WORKFLOW_ICON_URI,
  USER_ICON_URI,
  iconConfig,
  plusFieldConfig,
  triggerPlusFieldConfig,
  sequencePlusFieldConfig,
  startPlusFieldConfig,
} from './icons'

import './mutators'
import './collapseSummary'
import {
  GESTURE_DROPDOWN_OPTIONS,
  VOICE_DROPDOWN_OPTIONS,
} from 'constants/recognitionRegistry'

// Re-export palette and icons for consumers that import from this file directly.
// Prefer importing from './palette' or './icons' in new code.
export { blocksColours } from './palette'
export { SHADOW_ICON_URIS } from './icons'

// ─── 1. ENTITY BLOCKS (OBJECTS, DESTINATIONS, PROCEDURES) ────────────────────
// These blocks carry a reference to a user-defined entity (object, location,
// or robot action). Their `data` field stores a JSON string with { id, name, keywords }.
// The entity mutators (registered in mutators.ts) keep tooltip/warning in sync.

Blockly.defineBlocksWithJsonArray([
  {
    type: 'object_block',
    message0: '%1 %2',
    args0: [
      // MAPPING REFERENCE:
      // - Block type: 'object_block' ➔ Displays user-facing Box icon to match Sidebar Objects
      iconConfig(BOX_ICON_URI, 'OBJECT:'),
      { type: 'field_label_serializable', name: 'name', text: '' },
    ],
    output: 'object_block',
    colour: blocksColours.objectsPositions,
    mutator: 'object_block_mutation',
  },
  {
    type: 'location_block',
    message0: '%1 %2',
    args0: [
      // MAPPING REFERENCE:
      // - Block type: 'location_block' ➔ Displays user-facing prefix 'LOCATION:'
      iconConfig(MAP_PIN_ICON_URI, 'LOCATION:'),
      { type: 'field_label_serializable', name: 'name', text: '' },
    ],
    output: 'location_block',
    colour: blocksColours.objectsPositions,
    mutator: 'location_block_mutation',
  },
  {
    type: 'action_block',
    message0: '%1 %2',
    args0: [
      // MAPPING REFERENCE:
      // - Block type: 'action_block' ➔ Displays user-facing prefix 'SKILL:' (replaces ROUTINE/PROCEDURE)
      iconConfig(ZAP_ICON_URI, 'SKILL:'),
      { type: 'field_label_serializable', name: 'name', text: '' },
    ],
    output: 'action_block',
    colour: blocksColours.objectsPositions,
    mutator: 'action_block_mutation',
  },
])

// ─── 2. CONDITIONS & EVENTS ───────────────────────────────────────────────────
// Condition blocks output a Boolean value consumed by control-flow blocks
// (when_block, repeat_until_block) and the human_action_block's resume trigger.

Blockly.defineBlocksWithJsonArray([
  {
    type: 'find_object_block',
    message0: '%1 Object detected %2',
    args0: [
      iconConfig(SCAN_EYE_ICON_URI, 'Detect'),
      { type: 'input_value', name: 'OBJECT', check: 'object_block' },
    ],
    output: 'Boolean',
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.find_object_block,
  },
  {
    type: 'gesture_block',
    message0: '%1 Gesture detected %2',
    args0: [
      iconConfig(SCAN_EYE_ICON_URI, 'Detect'),
      {
        type: 'field_dropdown',
        name: 'GESTURE_TYPE',
        options: GESTURE_DROPDOWN_OPTIONS,
      },
    ],
    output: 'Boolean',
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.gesture_block,
  },
  {
    type: 'voice_command_block',
    message0: '%1 Voice command %2',
    args0: [
      iconConfig(MIC_ICON_URI, 'Voice'),
      {
        type: 'field_dropdown',
        name: 'VOICE_WORD',
        options: VOICE_DROPDOWN_OPTIONS,
      },
    ],
    output: 'Boolean',
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.voice_command_block,
  },
  {
    type: 'timer_block',
    message0: '%1 %2 seconds have passed',
    args0: [
      iconConfig(CLOCK_ICON_URI, 'Timer'),
      { type: 'field_number', name: 'SECONDS', value: 5, min: 1 },
    ],
    output: 'Boolean',
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.timer_block,
  },
  {
    type: 'logic_and_block',
    message0: '%1 AND %2',
    args0: [
      { type: 'input_value', name: 'A', check: 'Boolean' },
      { type: 'input_value', name: 'B', check: 'Boolean' },
    ],
    output: 'Boolean',
    inputsInline: true,
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.logic_and_block,
  },
  {
    type: 'logic_or_block',
    message0: '%1 OR %2',
    args0: [
      { type: 'input_value', name: 'A', check: 'Boolean' },
      { type: 'input_value', name: 'B', check: 'Boolean' },
    ],
    output: 'Boolean',
    inputsInline: true,
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.logic_or_block,
  },
  {
    type: 'logic_not_block',
    message0: 'NOT %1',
    args0: [{ type: 'input_value', name: 'BOOL', check: 'Boolean' }],
    output: 'Boolean',
    inputsInline: true,
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.logic_not_block,
  },
])

// ─── 3. ROBOT ACTIONS ────────────────────────────────────────────────────────
// Statement blocks that produce robot motion or gripper commands.
// All accept `robot_sequence` or `logic_sequence` as their statement type
// so they can appear inside both the main chain and inside control-flow bodies.

Blockly.defineBlocksWithJsonArray([
  {
    type: 'pick_block',
    message0: '%1 Pick up %2',
    args0: [
      iconConfig(BOT_ICON_URI, 'ROBOT:'),
      { type: 'input_value', name: 'OBJECT', check: 'object_block' },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.robotActions,
    tooltip: blockDescriptionsByType.pick_block,
  },
  {
    type: 'processing_block',
    // MAPPING REFERENCE:
    // - Block type: 'processing_block' ➔ Displays user-facing sentence 'Execute skill [Skill]'
    message0: '%1 Execute skill %2',
    args0: [
      iconConfig(ZAP_ICON_URI, 'SKILL:'),
      { type: 'input_value', name: 'ACTION', check: 'action_block' },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.robotActions,
    tooltip: blockDescriptionsByType.processing_block,
  },
  {
    type: 'place_block',
    message0: '%1 Place at %2',
    args0: [
      iconConfig(BOT_ICON_URI, 'ROBOT:'),
      { type: 'input_value', name: 'LOCATION', check: 'location_block' },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.robotActions,
    tooltip: blockDescriptionsByType.place_block,
  },
  {
    type: 'move_to_block',
    message0: '%1 Move to %2',
    args0: [
      iconConfig(BOT_ICON_URI, 'ROBOT:'),
      {
        type: 'input_value',
        name: 'LOCATION',
        check: 'location_block',
      },
    ],
    message1: 'using %1',
    args1: [
      {
        type: 'field_dropdown',
        name: 'MOTION_TYPE',
        options: [
          ['Straight path', 'LINEAR'],
          ['Free path', 'JOINT'],
        ],
      },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.robotActions,
    tooltip: blockDescriptionsByType.move_to_block,
  },
  {
    type: 'gripper_block',
    message0: '%1 %2 Gripper',
    args0: [
      iconConfig(BOT_ICON_URI, 'ROBOT:'),
      {
        type: 'field_dropdown',
        name: 'GRIPPER_STATE',
        options: [
          ['Open', 'OPEN'],
          ['Close', 'CLOSE'],
        ],
      },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.robotActions,
    tooltip: blockDescriptionsByType.gripper_block,
  },
  {
    type: 'open_gripper_block',
    message0: '%1 Open Gripper',
    args0: [iconConfig(BOT_ICON_URI, 'ROBOT:')],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.robotActions,
    tooltip: blockDescriptionsByType.open_gripper_block,
  },
  {
    type: 'close_gripper_block',
    message0: '%1 Close Gripper',
    args0: [iconConfig(BOT_ICON_URI, 'ROBOT:')],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.robotActions,
    tooltip: blockDescriptionsByType.close_gripper_block,
  },
  {
    type: 'wait_block',
    message0: '%1 Wait %2 seconds',
    args0: [
      iconConfig(BOT_ICON_URI, 'ROBOT:'),
      { type: 'field_number', name: 'SECONDS', value: 3, min: 1 },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.robotActions,
    tooltip: blockDescriptionsByType.wait_block,
  },
])

// ─── 4. HUMAN STEPS ──────────────────────────────────────────────────────────
// Blocks that pause execution and involve a human operator.

Blockly.defineBlocksWithJsonArray([
  {
    type: 'human_action_block',
    message0: '%1 Pause and show: \n%2\n',
    args0: [
      iconConfig(USER_ICON_URI, 'HUMAN:'),
      {
        type: 'field_input',
        name: 'TASK_DESC',
        text: 'Load the next item',
      },
    ],
    message1: 'Resume when: %1',
    args1: [
      {
        type: 'input_value',
        name: 'CONFIRM_EVENT',
        check: 'Boolean',
      },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    inputsInline: false,
    colour: blocksColours.humanActions,
    tooltip: blockDescriptionsByType.human_action_block,
  },
  {
    type: 'notify_action_block',
    message0: '%1 Show message and continue: \n%2',
    args0: [
      iconConfig(USER_ICON_URI, 'HUMAN:'),
      {
        type: 'field_input',
        name: 'TASK_DESC',
        text: 'Prepare the next component',
      },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.humanActions,
    tooltip: blockDescriptionsByType.notify_action_block,
  },
])

// ─── 5. TASK FLOW (LOGIC & CONTROL) ──────────────────────────────────────────
// Control-flow blocks that wrap sequences: loops, conditionals.
// Only the block types listed in `BLOCKS_WITH_COLLAPSIBLE_BODY` in contextMenu.ts
// expose the "collapse/expand" context-menu option.

Blockly.defineBlocksWithJsonArray([
  {
    type: 'repeat_block',
    extensions: ['collapsed_summary'],
    message0: '%1 Repeat %2 times',
    args0: [
      iconConfig(REPEAT2_ICON_URI, 'Repeat'),
      { type: 'field_number', name: 'times', value: 2, min: 1, max: 99 },
    ],
    message1: 'Do %1',
    args1: [
      {
        type: 'input_statement',
        name: 'DO',
        check: ['robot_sequence', 'logic_sequence'],
      },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.logicControl,
    tooltip: blockDescriptionsByType.repeat_block,
  },
  {
    type: 'repeat_until_block',
    extensions: ['collapsed_summary'],
    message0: '%1 Repeat until %2',
    args0: [
      iconConfig(REPEAT2_ICON_URI, 'Repeat'),
      {
        type: 'input_value',
        name: 'CONDITION',
        check: 'Boolean',
      },
    ],
    message1: 'Do %1',
    args1: [
      {
        type: 'input_statement',
        name: 'DO',
        check: ['robot_sequence', 'logic_sequence'],
      },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.logicControl,
    tooltip: blockDescriptionsByType.repeat_until_block,
  },
  {
    type: 'when_block',
    extensions: ['collapsed_summary'],
    message0: '%1 When %2',
    args0: [
      iconConfig(SPLIT_ICON_URI, 'When'),
      {
        type: 'input_value',
        name: 'WHEN',
        check: 'Boolean',
      },
    ],
    message1: 'Do %1',
    args1: [
      {
        type: 'input_statement',
        name: 'DO',
        check: ['robot_sequence', 'logic_sequence'],
      },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.logicControl,
    tooltip: blockDescriptionsByType.when_block,
  },
  {
    type: 'when_otherwise_block',
    extensions: ['collapsed_summary'],
    message0: '%1 When %2',
    args0: [
      iconConfig(SPLIT_ICON_URI, 'When'),
      {
        type: 'input_value',
        name: 'WHEN',
        check: 'Boolean',
      },
    ],
    message1: 'Do %1',
    args1: [
      {
        type: 'input_statement',
        name: 'DO',
        check: ['robot_sequence', 'logic_sequence'],
      },
    ],
    message2: 'Otherwise %1',
    args2: [
      {
        type: 'input_statement',
        name: 'OTHERWISE',
        check: ['robot_sequence', 'logic_sequence'],
      },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.logicControl,
    tooltip: blockDescriptionsByType.when_otherwise_block,
  },
])

// ─── 6. MACRO TASKS ──────────────────────────────────────────────────────────
// A macro_task_block references another saved task by ID.
// Its `data` field stores { id, name } and the macro_block_mutation
// (registered in mutators.ts) shows a warning when the referenced task
// is no longer available.

Blockly.defineBlocksWithJsonArray([
  {
    type: 'macro_task_block',
    message0: '%1 Do: %2',
    args0: [
      iconConfig(WORKFLOW_ICON_URI, 'TASK:'),
      { type: 'field_label_serializable', name: 'name', text: '' },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.macroTasks,
    mutator: 'macro_block_mutation',
    tooltip: blockDescriptionsByType.macro_task_block,
  },
])

// ─── 7. ENTRY POINT — when_start ─────────────────────────────────────────────
// The mandatory start block inserted automatically by `ensureStartBlock`.
// It is set non-deletable and non-movable at runtime (see startBlock.ts).

Blockly.defineBlocksWithJsonArray([
  {
    type: 'when_start',
    message0: '%1 Start of Task',
    args0: [iconConfig(FLAG_ICON_URI, 'START:', 18, 18)],
    nextStatement: null,
    colour: blocksColours.start,
    tooltip: blockDescriptionsByType.when_start,
  },
])

// ─── 8. SHADOW PLACEHOLDER BLOCKS ────────────────────────────────────────────
// Shadow blocks are interactive "empty slot" indicators with a "+" icon.
// Clicking one opens the shadow picker (ShadowPickerMenu) so the user can
// select a real block to connect without drag-and-drop.
//
// The `shadow_placeholder_extension` adds a CSS class to each shadow block
// based on its connection context, enabling distinct styling per slot type.

/** Internal type augment for blocks that expose Blockly SVG lifecycle methods. */
type BlockWithSvgHooks = Blockly.Block & {
  initSvg?: () => void
  getSvgRoot?: () => SVGGElement | null
}

/**
 * Blockly extension registered on every shadow placeholder block.
 * Marks the block as a shadow, then patches `initSvg` to add a CSS class
 * reflecting the shadow type (trigger / sequence / start / workspace).
 */
Blockly.Extensions.register('shadow_placeholder_extension', function () {
  const block = this as BlockWithSvgHooks
  block.setShadow(true)

  const originalInitSvg = block.initSvg

  // Determine the CSS class by block type so different slot contexts can be
  // styled independently (colour, border, icon tint).
  const cssClass =
    block.type === 'shadow_trigger_block'
      ? 'custom-dashed-shadow-trigger'
      : block.type === 'shadow_sequence_block'
        ? 'custom-dashed-shadow-sequence'
        : block.type === 'shadow_start_sequence_block'
          ? 'custom-dashed-shadow-start'
          : 'custom-dashed-shadow-workspace'

  block.initSvg = function (this: Blockly.Block) {
    originalInitSvg?.call(this)
    const svgRoot = (this as BlockWithSvgHooks).getSvgRoot?.()
    if (svgRoot) {
      svgRoot.classList.add(cssClass)
      svgRoot.classList.add('shadow-block--base')
    }
  }
})

// ─── Shadow block factory helpers ─────────────────────────────────────────────

/**
 * Build the JSON definition for an entity shadow block (object / location / action).
 * The output type matches the corresponding real block so Blockly validates connections.
 */
const createShadowEntityBlock = (
  type: 'shadow_object_block' | 'shadow_location_block' | 'shadow_action_block',
  output: 'object_block' | 'location_block' | 'action_block',
  label: string,
) => ({
  type,
  message0: '%1 %2',
  args0: [
    { type: 'field_label_serializable', name: 'name', text: label },
    plusFieldConfig(),
  ],
  output,
  colour: blocksColours.objectsPositions,
  extensions: ['shadow_placeholder_extension'],
})

/** Build the JSON definition for the condition/trigger shadow block. */
const createShadowTriggerBlock = () => ({
  type: 'shadow_trigger_block',
  message0: '%1 %2',
  args0: [
    {
      type: 'field_label_serializable',
      name: 'name',
      text: 'Select Condition',
    },
    triggerPlusFieldConfig(),
  ],
  output: 'Boolean',
  colour: blocksColours.eventsConditions,
  extensions: ['shadow_placeholder_extension'],
  tooltip: 'Insert a Conditions block here.',
})

/** Build the JSON definition for the sequence (next-step) shadow block. */
const createShadowSequenceBlock = () => ({
  type: 'shadow_sequence_block',
  message0: '%1 %2',
  args0: [
    { type: 'field_label_serializable', name: 'name', text: 'Add a step' },
    sequencePlusFieldConfig(),
  ],
  previousStatement: ['robot_sequence', 'logic_sequence'],
  nextStatement: ['robot_sequence', 'logic_sequence'],
  colour: blocksColours.placeholder,
  extensions: ['shadow_placeholder_extension'],
  tooltip: 'Drop a block here to add a step.',
})

/**
 * Build the JSON definition for the first-step shadow block, placed
 * directly below `when_start`. Uses the start-accent colour.
 */
const createShadowStartSequenceBlock = () => ({
  type: 'shadow_start_sequence_block',
  message0: '%1 %2',
  args0: [
    {
      type: 'field_label_serializable',
      name: 'name',
      text: 'Add first step',
    },
    startPlusFieldConfig(),
  ],
  previousStatement: ['robot_sequence', 'logic_sequence'],
  nextStatement: ['robot_sequence', 'logic_sequence'],
  colour: blocksColours.start,
  extensions: ['shadow_placeholder_extension'],
  tooltip: 'Connect the first block of your program here.',
})

Blockly.defineBlocksWithJsonArray([
  createShadowEntityBlock(
    'shadow_object_block',
    'object_block',
    'Select Object',
  ),
  createShadowEntityBlock(
    'shadow_location_block',
    'location_block',
    // MAPPING REFERENCE: shadow placeholder for location_block ➔ Select Location
    'Select Location',
  ),
  createShadowEntityBlock(
    'shadow_action_block',
    'action_block',
    // MAPPING REFERENCE: shadow placeholder for action_block ➔ Select Skill
    'Select Skill',
  ),
  createShadowTriggerBlock(),
  createShadowSequenceBlock(),
  createShadowStartSequenceBlock(),
])
