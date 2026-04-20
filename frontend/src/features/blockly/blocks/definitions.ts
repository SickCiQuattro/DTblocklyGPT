import * as Blockly from 'blockly/core'

import { blockDescriptionsByType } from './blockTextDictionary'

// ─── COLOR PALETTE ────────────────────────────────────────────────────────
export const blocksColours = {
  /** Logic/Control flow blocks (repeat, when, loop) */
  logicControl: '#978676',
  /** Robot manipulation actions (pick, place, move, gripper) */
  robotActions: '#3153D3',
  /** Human operator actions (wait for human, human action) */
  humanActions: '#F58C00',
  /** User-defined entities: objects, locations, robot actions */
  objectsPositions: '#00BD56',
  /** Conditions and event triggers (sensors, find object, touch, timer) */
  eventsConditions: '#E15930',
  /** Macro-tasks / predefined sub-routines */
  macroTasks: '#3B97F4',
} as const

// ─── ICONS (BASE64 FROM LUCIDE-REACT) ─────────────────────────────────────
// Icona "Bot" (Robot) con tratto bianco
const BOT_ICON_B64 =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTEyIDhWNEg4Ii8+PHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjEyIiB4PSI0IiB5PSI4IiByeD0iMiIvPjxwYXRoIGQ9Ik0yIDE0aDIiLz48cGF0aCBkPSJNMjAgMTRoMiIvPjxwYXRoIGQ9Ik0xNSAxM3YyIi8+PHBhdGggZD0iTTkgMTN2MiIvPjwvc3ZnPg=='

// Icona "User" (Human) con tratto bianco
const USER_ICON_B64 =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTE5IDIxdi0yYTQgNCAwIDAgMC00LTRIOWE0IDQgMCAwIDAtNCA0djIiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjciIHI9IjQiLz48L3N2Zz4='

// Icona "Layers" (Sub-routine / Macro) con tratto bianco
const ROUTINE_ICON_B64 =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBvbHlnb24gcG9pbnRzPSIxMiAyIDIgNyAxMiAxMiAyMiA3IDEyIDIiLz48cG9seWxpbmUgcG9pbnRzPSIyIDEyIDEyIDE3IDIyIDEyIi8+PHBvbHlsaW5lIHBvaW50cz0iMiAxNyAxMiAyMiAyMiAxNyIvPjwvc3ZnPg=='

const iconConfig = (src: string, alt: string) => ({
  type: 'field_image',
  src: src,
  width: 18,
  height: 18,
  alt: alt,
  flipRtl: false,
})

// ─── UTILS & MUTATORS ─────────────────────────────────────────────────────
const parseBlockData = (rawData: unknown) => {
  if (typeof rawData !== 'string' || rawData.length === 0) return null

  try {
    const parsed = JSON.parse(rawData) as unknown
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as { id?: unknown; keywords?: unknown })
      : null
  } catch {
    return null
  }
}

const applyEntityMetadata = (block: Blockly.Block, missingWarning: string) => {
  const data = parseBlockData(block.data)

  const keywords =
    typeof data?.keywords === 'string'
      ? data.keywords
          .split(',')
          .map((keyword) => keyword.trim())
          .filter((keyword) => keyword.length > 0)
          .join(', ')
      : ''

  const tooltipText = keywords.length > 0 ? `Keywords: ${keywords}` : ''

  block.setTooltip(tooltipText)
  block.setWarningText(data?.id ? null : missingWarning)
}

const registerEntityMutator = (id: string, missingWarning: string) => {
  Blockly.Extensions.registerMutator(id, {
    mutationToDom(this: Blockly.Block) {
      applyEntityMetadata(this, missingWarning)
      return Blockly.utils.xml.createElement('mutation')
    },
    domToMutation(this: Blockly.Block) {
      applyEntityMetadata(this, missingWarning)
    },
    saveExtraState() {
      return null
    },
    loadExtraState(this: Blockly.Block) {
      applyEntityMetadata(this, missingWarning)
    },
  })
}

registerEntityMutator('object_block_mutation', 'Object not defined')
registerEntityMutator('location_block_mutation', 'Location not defined')
registerEntityMutator('action_block_mutation', 'Action not defined')
registerEntityMutator('macro_block_mutation', 'Routine not defined')

// ─── 1. ENTITIES (OBJECTS, POSITIONS, ACTIONS) ────────────────────────────
Blockly.defineBlocksWithJsonArray([
  {
    type: 'object_block',
    message0: '%1',
    args0: [{ type: 'field_label_serializable', name: 'name', text: '' }],
    output: 'object_block',
    colour: blocksColours.objectsPositions,
    mutator: 'object_block_mutation',
  },
  {
    type: 'location_block',
    message0: '%1',
    args0: [{ type: 'field_label_serializable', name: 'name', text: '' }],
    output: 'location_block',
    colour: blocksColours.objectsPositions,
    mutator: 'location_block_mutation',
  },
  {
    type: 'action_block',
    message0: '%1',
    args0: [{ type: 'field_label_serializable', name: 'name', text: '' }],
    output: 'action_block',
    colour: blocksColours.objectsPositions,
    mutator: 'action_block_mutation',
  },
])

// ─── 2. EVENTS & CONDITIONS ───────────────────────────────────────────────
Blockly.defineBlocksWithJsonArray([
  {
    type: 'sensor_signal_block',
    message0: 'External Sensor is ON',
    output: 'sensor_signal_block',
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.sensor_signal_block,
  },
  {
    type: 'find_object_block',
    message0: 'Object %1 is Found',
    args0: [{ type: 'input_value', name: 'OBJECT', check: 'object_block' }],
    output: 'find_object_block',
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.find_object_block,
  },
  {
    type: 'touch_detect_block',
    message0: 'Robot is Touched',
    output: 'touch_detect_block',
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.touch_detect_block,
  },
  {
    type: 'gesture_block',
    message0: 'Gesture %1 is Seen',
    args0: [
      {
        type: 'field_dropdown',
        name: 'GESTURE_TYPE',
        options: [
          ['Thumbs Up', 'THUMBS_UP'],
          ['Stop Hand', 'STOP'],
        ],
      },
    ],
    output: 'gesture_block',
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.gesture_block,
  },
  {
    type: 'timer_block',
    message0: '%1 Seconds have passed',
    args0: [{ type: 'field_number', name: 'SECONDS', value: 5, min: 1 }],
    output: 'timer_block',
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.timer_block,
  },
])

// ─── 3. ROBOT ACTIONS ─────────────────────────────────────────────────────
Blockly.defineBlocksWithJsonArray([
  {
    type: 'pick_block',
    message0: '%1 Pick Up %2',
    args0: [
      iconConfig(BOT_ICON_B64, 'ROBOT:'),
      { type: 'input_value', name: 'OBJECT', check: 'object_block' },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.robotActions,
    tooltip: blockDescriptionsByType.pick_block,
  },
  {
    type: 'processing_block',
    message0: '%1 Execute Skill %2',
    args0: [
      iconConfig(BOT_ICON_B64, 'ROBOT:'),
      { type: 'input_value', name: 'ACTION', check: 'action_block' },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.robotActions,
    tooltip: blockDescriptionsByType.processing_block,
  },
  {
    type: 'place_block',
    message0: '%1 Put Down at %2',
    args0: [
      iconConfig(BOT_ICON_B64, 'ROBOT:'),
      { type: 'input_value', name: 'LOCATION', check: 'location_block' },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.robotActions,
    tooltip: blockDescriptionsByType.place_block,
  },
  {
    type: 'move_to_block',
    message0: '%1 Go To Location %2',
    args0: [
      iconConfig(BOT_ICON_B64, 'ROBOT:'),
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
          ['Linear motion', 'LINEAR'],
          ['Joint motion (Fast)', 'JOINT'],
        ],
      },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.robotActions,
    tooltip: blockDescriptionsByType.move_to_block,
  },
  {
    type: 'move_relative_block',
    message0: '%1 Shift Position %2 by %3 mm',
    args0: [
      iconConfig(BOT_ICON_B64, 'ROBOT:'),
      {
        type: 'field_dropdown',
        name: 'AXIS',
        options: [
          ['Z-Axis (Up/Down)', 'Z'],
          ['X-Axis', 'X'],
          ['Y-Axis', 'Y'],
        ],
      },
      { type: 'field_number', name: 'DISTANCE', value: 50 },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.robotActions,
    tooltip: blockDescriptionsByType.move_relative_block,
  },
  {
    type: 'gripper_block',
    message0: '%1 %2 Gripper',
    args0: [
      iconConfig(BOT_ICON_B64, 'ROBOT:'),
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
])

// ─── 4. HUMAN ACTIONS ─────────────────────────────────────────────────────
Blockly.defineBlocksWithJsonArray([
  {
    type: 'human_action_block',
    message0: '%1 Wait for Operator: %2',
    args0: [
      iconConfig(USER_ICON_B64, 'HUMAN:'),
      { type: 'field_input', name: 'TASK_DESC', text: 'insert component' },
    ],
    message1: 'Resume when: %1',
    args1: [
      {
        type: 'input_value',
        name: 'CONFIRM_EVENT',
        check: [
          'touch_detect_block',
          'gesture_block',
          'timer_block',
          'sensor_signal_block',
          'human_feedback_block',
        ],
      },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.humanActions,
    tooltip: blockDescriptionsByType.human_action_block,
  },
])

// ─── 5. LOGIC & CONTROL ───────────────────────────────────────────────────
Blockly.defineBlocksWithJsonArray([
  {
    type: 'repeat_block',
    message0: 'Repeat %1 Times',
    args0: [{ type: 'field_number', name: 'times', value: 2, min: 1, max: 99 }],
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
    type: 'loop_block',
    message0: 'Repeat Forever',
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
    tooltip: blockDescriptionsByType.loop_block,
  },
  {
    type: 'when_block',
    message0: 'If %1',
    args0: [
      {
        type: 'input_value',
        name: 'WHEN',
        check: [
          'find_object_block',
          'sensor_signal_block',
          'touch_detect_block',
          'gesture_block',
          'timer_block',
        ],
      },
    ],
    message1: 'Then Do %1',
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
    message0: 'If %1',
    args0: [
      {
        type: 'input_value',
        name: 'WHEN',
        check: [
          'find_object_block',
          'sensor_signal_block',
          'touch_detect_block',
          'gesture_block',
          'timer_block',
        ],
      },
    ],
    message1: 'Then Do %1',
    args1: [
      {
        type: 'input_statement',
        name: 'DO',
        check: ['robot_sequence', 'logic_sequence'],
      },
    ],
    message2: 'Else %1',
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

// ─── 6. MACRO TASKS ────────────────────────────────────────────────────────────
Blockly.defineBlocksWithJsonArray([
  {
    type: 'macro_task_block',
    message0: '%1 Run: %2', // Run Routine:
    args0: [
      iconConfig(ROUTINE_ICON_B64, 'ROUTINE:'),
      { type: 'field_label_serializable', name: 'name', text: '' },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.macroTasks,
    mutator: 'macro_block_mutation',
    tooltip: blockDescriptionsByType.macro_task_block,
  },
])
