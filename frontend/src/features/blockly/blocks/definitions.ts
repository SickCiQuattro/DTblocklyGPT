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

// ─── ICON HELPERS ────────────────────────────────────────────────────────

/**
 * Generates a Blockly-friendly Data URI from raw Lucide-like SVG inner markup.
 * Paste the inner tags (<path>, <circle>, <rect>, ...) directly from the source icon.
 *
 * @param svgContent Inner SVG nodes as a string
 * @param color Stroke color. Defaults to white.
 */
const createLucideIconURI = (svgContent: string, color: string = 'white') => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgContent}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const BOT_ICON_URI = createLucideIconURI(
  '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
)

const USER_ICON_URI = createLucideIconURI(
  '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
)

const CIRCLE_PLUS_ICON_URI = createLucideIconURI(
  '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  blocksColours.objectsPositions,
)

const CIRCLE_PLUS_TRIGGER_ICON_URI = createLucideIconURI(
  '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  blocksColours.eventsConditions,
)

const CIRCLE_PLUS_SEQUENCE_ICON_URI = createLucideIconURI(
  '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  '#9E9E9E',
)

const TAG_ICON_URI = createLucideIconURI(
  '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
)

const MAP_PIN_ICON_URI = createLucideIconURI(
  '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
)

const WRENCH_ICON_URI = createLucideIconURI(
  '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>',
)

const WORKFLOW_ICON_URI = createLucideIconURI(
  '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
)

const SCAN_EYE_ICON_URI = createLucideIconURI(
  '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="1"/><path d="M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0"/>',
)

const sequencePlusFieldConfig = () =>
  iconConfig(CIRCLE_PLUS_SEQUENCE_ICON_URI, '+', 14, 14)

const iconConfig = (src: string, alt: string, width = 18, height = 18) => ({
  type: 'field_image',
  src,
  width,
  height,
  alt: alt,
  flipRtl: false,
})

const plusFieldConfig = () => iconConfig(CIRCLE_PLUS_ICON_URI, '+', 14, 14)
const triggerPlusFieldConfig = () =>
  iconConfig(CIRCLE_PLUS_TRIGGER_ICON_URI, '+', 14, 14)

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
registerEntityMutator('location_block_mutation', 'Destination not defined')
registerEntityMutator('action_block_mutation', 'Procedure not defined')
registerEntityMutator('macro_block_mutation', 'Task not defined')

// ─── EXTENSION: CUSTOM DASHED SHADOW BLOCKS ──────────────────────────────
type BlockWithSvgHooks = Blockly.Block & {
  initSvg?: () => void
  getSvgRoot?: () => SVGGElement | null
}

Blockly.Extensions.register('shadow_placeholder_extension', function () {
  const block = this as BlockWithSvgHooks
  block.setShadow(true)

  const originalInitSvg = block.initSvg

  const cssClass =
    block.type === 'shadow_trigger_block'
      ? 'custom-dashed-shadow-trigger'
      : block.type === 'shadow_sequence_block'
        ? 'custom-dashed-shadow-sequence'
        : 'custom-dashed-shadow-workspace'

  block.initSvg = function (this: Blockly.Block) {
    originalInitSvg?.call(this)
    const svgRoot = (this as BlockWithSvgHooks).getSvgRoot?.()
    if (svgRoot) svgRoot.classList.add(cssClass)
  }
})

// ─── 1. ENTITIES (OBJECTS, POSITIONS, ACTIONS) ────────────────────────────
Blockly.defineBlocksWithJsonArray([
  {
    type: 'object_block',
    message0: '%1 %2',
    args0: [
      iconConfig(TAG_ICON_URI, 'OBJECT:'),
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
      iconConfig(MAP_PIN_ICON_URI, 'DESTINATION:'),
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
      iconConfig(WRENCH_ICON_URI, 'PROCEDURE:'),
      { type: 'field_label_serializable', name: 'name', text: '' },
    ],
    output: 'action_block',
    colour: blocksColours.objectsPositions,
    mutator: 'action_block_mutation',
  },
])

// ─── 2. EVENTS & CONDITIONS ───────────────────────────────────────────────
Blockly.defineBlocksWithJsonArray([
  {
    type: 'sensor_signal_block',
    message0: '%1 External signal received',
    args0: [iconConfig(SCAN_EYE_ICON_URI, 'SENSOR:')],
    output: 'Boolean',
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.sensor_signal_block,
  },
  {
    type: 'find_object_block',
    message0: '%1 Object detected %2',
    args0: [
      iconConfig(SCAN_EYE_ICON_URI, 'SENSOR:'),
      { type: 'input_value', name: 'OBJECT', check: 'object_block' },
    ],
    output: 'Boolean',
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.find_object_block,
  },
  {
    type: 'touch_detect_block',
    message0: '%1 Contact detected',
    args0: [iconConfig(SCAN_EYE_ICON_URI, 'SENSOR:')],
    output: 'Boolean',
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.touch_detect_block,
  },
  {
    type: 'gesture_block',
    message0: '%1 Gesture detected %2',
    args0: [
      iconConfig(SCAN_EYE_ICON_URI, 'SENSOR:'),
      {
        type: 'field_dropdown',
        name: 'GESTURE_TYPE',
        options: [
          ['Thumbs up', 'THUMBS_UP'],
          ['Open hand', 'OPEN_HAND'],
        ],
      },
    ],
    output: 'Boolean',
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.gesture_block,
  },
  {
    type: 'timer_block',
    message0: '%1 %2 seconds have passed',
    args0: [
      iconConfig(SCAN_EYE_ICON_URI, 'SENSOR:'),
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

// ─── 3. ROBOT ACTIONS ─────────────────────────────────────────────────────
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
    message0: '%1 Perform %2',
    args0: [
      iconConfig(BOT_ICON_URI, 'ROBOT:'),
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

// ─── 4. HUMAN ACTIONS ─────────────────────────────────────────────────────
Blockly.defineBlocksWithJsonArray([
  {
    type: 'human_action_block',
    message0: '%1 Pause and show: \n%2\n',
    args0: [
      iconConfig(USER_ICON_URI, 'HUMAN:'),
      {
        type: 'field_input',
        name: 'TASK_DESC',
        text: 'Describe what the person must do',
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
])

Blockly.defineBlocksWithJsonArray([
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

// ─── 5. LOGIC & CONTROL ───────────────────────────────────────────────────
Blockly.defineBlocksWithJsonArray([
  {
    type: 'repeat_block',
    message0: 'Repeat %1 times',
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
    message0: 'Repeat forever',
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
    type: 'repeat_until_block',
    message0: 'Repeat until %1',
    args0: [
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
    message0: 'When %1',
    args0: [
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
    message0: 'When %1',
    args0: [
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

// ─── 6. MACRO TASKS ────────────────────────────────────────────────────────────
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

// ─── SHADOW PLACEHOLDERS WITH "+" ICON ────────────────────────────────────
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

Blockly.defineBlocksWithJsonArray([
  createShadowEntityBlock(
    'shadow_object_block',
    'object_block',
    'Select Object',
  ),
  createShadowEntityBlock(
    'shadow_location_block',
    'location_block',
    'Select Destination',
  ),
  createShadowEntityBlock(
    'shadow_action_block',
    'action_block',
    'Select Procedure',
  ),
  createShadowTriggerBlock(),
])

// Aggiungi in fondo alla sezione "SHADOW PLACEHOLDERS WITH '+' ICON"

const createShadowSequenceBlock = () => ({
  type: 'shadow_sequence_block',
  message0: '%1 %2',
  args0: [
    { type: 'field_label_serializable', name: 'name', text: 'Add a step' },
    sequencePlusFieldConfig(),
  ],
  // Fondamentale: previousStatement + nextStatement, NON output
  previousStatement: ['robot_sequence', 'logic_sequence'],
  nextStatement: ['robot_sequence', 'logic_sequence'],
  colour: '#7A7A8A',
  extensions: ['shadow_placeholder_extension'],
  tooltip: 'Drop a block here to add a step.',
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
    'Select Destination',
  ),
  createShadowEntityBlock(
    'shadow_action_block',
    'action_block',
    'Select Procedure',
  ),
  createShadowTriggerBlock(),
  createShadowSequenceBlock(), // ← nuovo
])
