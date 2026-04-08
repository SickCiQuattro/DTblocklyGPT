import * as Blockly from 'blockly/core'
import './index.css'

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
  /** Macro-tasks / predefined sub-routines (future use) */
  macroTasks: '#3B97F4',
} as const

// ─── UTILS & MUTATORS ─────────────────────────────────────────────────────
const parseBlockData = (rawData: unknown) => {
  if (typeof rawData !== 'string' || rawData.length === 0) return null
  try {
    return JSON.parse(rawData)
  } catch {
    return null
  }
}

const applyEntityMetadata = (block: any, missingWarning: string) => {
  const data = parseBlockData(block.data)
  const keywords = data?.keywords

  const tooltipText =
    typeof keywords === 'string' && keywords.length > 0
      ? `Keywords: ${keywords.split(',').join(', ')}`
      : ''

  block.setTooltip(tooltipText)
  block.setWarningText(data?.id ? null : missingWarning)
}

Blockly.Extensions.registerMutator('object_block_mutation', {
  mutationToDom(this: any) {
    applyEntityMetadata(this, 'Object not defined')
    return Blockly.utils.xml.createElement('mutation')
  },
  domToMutation(this: any) { applyEntityMetadata(this, 'Object not defined') },
  saveExtraState(this: any) { return null },
  loadExtraState(this: any) { applyEntityMetadata(this, 'Object not defined') },
})

Blockly.Extensions.registerMutator('location_block_mutation', {
  mutationToDom(this: any) {
    applyEntityMetadata(this, 'Location not defined')
    return Blockly.utils.xml.createElement('mutation')
  },
  domToMutation(this: any) { applyEntityMetadata(this, 'Location not defined') },
  saveExtraState(this: any) { return null },
  loadExtraState(this: any) { applyEntityMetadata(this, 'Location not defined') },
})

Blockly.Extensions.registerMutator('action_block_mutation', {
  mutationToDom(this: any) {
    applyEntityMetadata(this, 'Action not defined')
    return Blockly.utils.xml.createElement('mutation')
  },
  domToMutation(this: any) { applyEntityMetadata(this, 'Action not defined') },
  saveExtraState(this: any) { return null },
  loadExtraState(this: any) { applyEntityMetadata(this, 'Action not defined') },
})

// ─── 1. ENTITIES (OBJECTS & POSITIONS) ────────────────────────────────────
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
    message0: 'EVENT: Sensor signal is true',
    output: 'sensor_signal_block',
    colour: blocksColours.eventsConditions,
    tooltip: 'Triggers when a generic external sensor signal is received.',
  },
  {
    type: 'find_object_block',
    message0: 'EVENT: Find %1',
    args0: [{ type: 'input_value', name: 'OBJECT', check: 'object_block' }],
    output: 'find_object_block',
    colour: blocksColours.eventsConditions,
    tooltip: 'Searches for a specific object using the 3D vision system.',
  },
  {
    type: 'touch_detect_block',
    message0: 'EVENT: Touch Detected',
    output: 'touch_detect_block',
    colour: blocksColours.eventsConditions,
    tooltip: 'Detects a physical touch or a torque peak on the Cobot\'s joints.',
  },
  {
    type: 'gesture_block',
    message0: 'EVENT: Gesture %1',
    args0: [
      {
        type: 'field_dropdown',
        name: 'GESTURE_TYPE',
        options: [['Thumbs Up', 'THUMBS_UP'], ['Stop Hand', 'STOP']],
      },
    ],
    output: 'gesture_block',
    colour: blocksColours.eventsConditions,
    tooltip: 'Detects a specific hand gesture from the operator via camera.',
  },
  {
    type: 'timer_block',
    message0: 'EVENT: Time elapsed %1 s',
    args0: [{ type: 'field_number', name: 'SECONDS', value: 5, min: 1 }],
    output: 'timer_block',
    colour: blocksColours.eventsConditions,
    tooltip: 'Returns true when the specified time in seconds has elapsed.',
  },
])

// ─── 3. ROBOT ACTIONS ─────────────────────────────────────────────────────
// Nota: Usiamo 'robot_sequence' e 'logic_sequence' per permettere incastri flessibili
Blockly.defineBlocksWithJsonArray([
  {
    type: 'pick_block',
    message0: 'ROBOT: Pick %1',
    args0: [{ type: 'input_value', name: 'OBJECT', check: 'object_block' }],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.robotActions,
    tooltip: 'Activates the robot\'s gripper to grasp the selected object.',
  },
  {
    type: 'place_block',
    message0: 'ROBOT: Place %1',
    args0: [{ type: 'input_value', name: 'LOCATION', check: 'location_block' }],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.robotActions,
    tooltip: 'Places the currently held object at the specified destination.',
  },
  {
    type: 'move_to_block',
    message0: 'ROBOT: Move %1 to %2',
    args0: [
      {
        type: 'field_dropdown',
        name: 'MOTION_TYPE',
        options: [['Linear', 'LINEAR'], ['Joints (Fast)', 'JOINT']],
      },
      { type: 'input_value', name: 'LOCATION', check: 'location_block' },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.robotActions,
    tooltip: 'Moves the robotic arm to a destination using linear or joint trajectories.',
  },
  {
    type: 'move_relative_block',
    message0: 'ROBOT: Move %1 by %2 mm',
    args0: [
      {
        type: 'field_dropdown',
        name: 'AXIS',
        options: [['Z-Axis (Up/Down)', 'Z'], ['X-Axis', 'X'], ['Y-Axis', 'Y']],
      },
      { type: 'field_number', name: 'DISTANCE', value: 50 },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.robotActions,
    tooltip: 'Moves the robot by a specific distance along a Cartesian axis (ideal for approaching or retreating from parts).',
  },
  {
    type: 'gripper_block',
    message0: 'ROBOT: %1 Gripper',
    args0: [
      {
        type: 'field_dropdown',
        name: 'GRIPPER_STATE',
        options: [['Open', 'OPEN'], ['Close', 'CLOSE']],
      },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.robotActions,
    tooltip: 'Explicitly opens or closes the Cobotta\'s gripper.',
  },
])

// ─── 4. HUMAN ACTIONS ─────────────────────────────────────────────────────
Blockly.defineBlocksWithJsonArray([
  {
    type: 'human_action_block',
    message0: 'HUMAN: Please %1',
    args0: [{ type: 'field_input', name: 'TASK_DESC', text: 'insert component' }],
    message1: 'RESUME ON: %1',
    args1: [
      {
        type: 'input_value',
        name: 'CONFIRM_EVENT',
        check: [
          'touch_detect_block', 
          'gesture_block', 
          'timer_block',
          'sensor_signal_block',
        ],
      },
    ],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.humanActions,
    tooltip: 'Pauses the cobot to allow human intervention, resuming upon activation of the chosen trigger.',
  },
])

// ─── 5. LOGIC & CONTROL ───────────────────────────────────────────────────
Blockly.defineBlocksWithJsonArray([
  {
    type: 'repeat_block',
    message0: 'CTRL: Repeat %1 times',
    args0: [{ type: 'field_number', name: 'times', value: 2, min: 1, max: 99 }],
    message1: 'Do %1',
    args1: [{ type: 'input_statement', name: 'DO', check: ['robot_sequence', 'logic_sequence'] }],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.logicControl,
    tooltip: 'Repeats a block of actions for a specified number of times.',
  },
  {
    type: 'loop_block',
    message0: 'CTRL: Loop',
    message1: 'Do %1',
    args1: [{ type: 'input_statement', name: 'DO', check: ['robot_sequence', 'logic_sequence'] }],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.logicControl,
    tooltip: 'Repeats actions indefinitely (useful for continuous sensory monitoring).',
  },
  {
    type: 'when_block',
    message0: 'CTRL: When %1',
    args0: [
      {
        type: 'input_value',
        name: 'WHEN',
        check: ['find_object_block', 'sensor_signal_block', 'touch_detect_block', 'gesture_block', 'timer_block'],
      },
    ],
    message1: 'Do %1',
    args1: [{ type: 'input_statement', name: 'DO', check: ['robot_sequence', 'logic_sequence'] }],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.logicControl,
    tooltip: 'Executes actions only if the specified condition is met.',
  },
  {
    type: 'when_otherwise_block',
    message0: 'CTRL: When %1',
    args0: [
      {
        type: 'input_value',
        name: 'WHEN',
        check: ['find_object_block', 'sensor_signal_block', 'touch_detect_block', 'gesture_block', 'timer_block'],
      },
    ],
    message1: 'Do %1',
    args1: [{ type: 'input_statement', name: 'DO', check: ['robot_sequence', 'logic_sequence'] }],
    message2: 'Otherwise %1',
    args2: [{ type: 'input_statement', name: 'OTHERWISE', check: ['robot_sequence', 'logic_sequence'] }],
    previousStatement: ['robot_sequence', 'logic_sequence'],
    nextStatement: ['robot_sequence', 'logic_sequence'],
    colour: blocksColours.logicControl,
    tooltip: 'Evaluates a condition and automatically chooses the alternative branch (If-Else).',
  },
])