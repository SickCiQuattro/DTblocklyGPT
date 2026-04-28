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

const ROUTINE_ICON_URI = createLucideIconURI(
  '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 12 12 17 22 12"/><polyline points="2 17 12 22 22 17"/>',
)

const CIRCLE_PLUS_ICON_URI = createLucideIconURI(
  '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  blocksColours.objectsPositions,
)

const CIRCLE_PLUS_TRIGGER_ICON_URI = createLucideIconURI(
  '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  blocksColours.eventsConditions,
)

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
  const originalInitSvg = block.initSvg

  const cssClass =
    block.type === 'shadow_trigger_block'
      ? 'custom-dashed-shadow-trigger'
      : 'custom-dashed-shadow-workspace'

  block.initSvg = function (this: Blockly.Block) {
    originalInitSvg?.call(this)

    // Attach a CSS hook to style each placeholder variant consistently.
    const svgRoot = (this as BlockWithSvgHooks).getSvgRoot?.()
    if (svgRoot) {
      svgRoot.classList.add(cssClass)
    }
  }
})

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
    message0: 'External signal received',
    output: 'Boolean',
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.sensor_signal_block,
  },
  {
    type: 'find_object_block',
    message0: 'Object detected %1',
    args0: [{ type: 'input_value', name: 'OBJECT', check: 'object_block' }],
    output: 'Boolean',
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.find_object_block,
  },
  {
    type: 'touch_detect_block',
    message0: 'Something touched',
    output: 'Boolean',
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.touch_detect_block,
  },
  {
    type: 'gesture_block',
    message0: 'Gesture detected %1',
    args0: [
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
    message0: '%1 seconds have passed',
    args0: [{ type: 'field_number', name: 'SECONDS', value: 5, min: 1 }],
    output: 'Boolean',
    colour: blocksColours.eventsConditions,
    tooltip: blockDescriptionsByType.timer_block,
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
])

// ─── 4. HUMAN ACTIONS ─────────────────────────────────────────────────────
Blockly.defineBlocksWithJsonArray([
  {
    type: 'human_action_block',
    message0: '%1 Pause and wait: %2',
    args0: [
      iconConfig(USER_ICON_URI, 'HUMAN:'),
      { type: 'field_input', name: 'TASK_DESC', text: 'insert component' },
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
    colour: blocksColours.humanActions,
    tooltip: blockDescriptionsByType.human_action_block,
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
      iconConfig(ROUTINE_ICON_URI, 'TASK:'),
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
