import * as Blockly from 'blockly/core'

export const blocksColours = {
  /** Logic/Control flow blocks (repeat, when, loop) */
  logicControl: '#978676',
  /** Robot manipulation actions (pick, place, processing) */
  robotActions: '#3153D3',
  /** Human operator actions (wait for human) */
  humanActions: '#F58C00',
  /** User-defined entities: objects, locations, robot actions */
  objectsPositions: '#00BD56',
  /** Conditions and event triggers (sensors, find object, human feedback) */
  eventsConditions: '#E15930',
  /** Macro-tasks / predefined sub-routines (future use) */
  macroTasks: '#3B97F4',
} as const

// Google Groups thread: https://groups.google.com/g/blockly/c/0Xg9_Jlrey4

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
  domToMutation(this: any) {
    applyEntityMetadata(this, 'Object not defined')
  },
  saveExtraState(this: any) {
    return null
  },
  loadExtraState(this: any) {
    applyEntityMetadata(this, 'Object not defined')
  },
})

Blockly.Extensions.registerMutator('location_block_mutation', {
  mutationToDom(this: any) {
    applyEntityMetadata(this, 'Location not defined')
    return Blockly.utils.xml.createElement('mutation')
  },
  domToMutation(this: any) {
    applyEntityMetadata(this, 'Location not defined')
  },
  saveExtraState(this: any) {
    return null
  },
  loadExtraState(this: any) {
    applyEntityMetadata(this, 'Location not defined')
  },
})

Blockly.Extensions.registerMutator('action_block_mutation', {
  mutationToDom(this: any) {
    applyEntityMetadata(this, 'Action not defined')
    return Blockly.utils.xml.createElement('mutation')
  },
  domToMutation(this: any) {
    applyEntityMetadata(this, 'Action not defined')
  },
  saveExtraState(this: any) {
    return null
  },
  loadExtraState(this: any) {
    applyEntityMetadata(this, 'Action not defined')
  },
})

Blockly.defineBlocksWithJsonArray([
  {
    type: 'object_block',
    message0: '%1',
    args0: [
      {
        type: 'field_label_serializable',
        name: 'name',
        text: '',
      },
    ],
    output: 'object_block',
    colour: blocksColours.objectsPositions,
    tooltip: '',
    helpUrl: '',
    mutator: 'object_block_mutation',
  },
  {
    type: 'location_block',
    message0: '%1',
    args0: [
      {
        type: 'field_label_serializable',
        name: 'name',
        text: '',
      },
    ],
    output: 'location_block',
    colour: blocksColours.objectsPositions,
    tooltip: '',
    helpUrl: '',
    mutator: 'location_block_mutation',
  },
  {
    type: 'action_block',
    message0: '%1',
    args0: [
      {
        type: 'field_label_serializable',
        name: 'name',
        text: '',
      },
    ],
    output: 'action_block',
    colour: blocksColours.objectsPositions,
    tooltip: '',
    helpUrl: '',
    mutator: 'action_block_mutation',
  },
])

Blockly.defineBlocksWithJsonArray([
  {
    type: 'sensor_signal_block',
    message0: 'EVENT: Camera sensor signal is true',
    output: 'sensor_signal_block',
    colour: blocksColours.eventsConditions,
    tooltip: 'Triggers when the camera sensor detects a signal.',
    helpUrl: '',
  },
  {
    type: 'human_feedback_block',
    message0: 'EVENT: Human feedback',
    output: 'human_feedback_block',
    colour: blocksColours.eventsConditions,
    tooltip: 'Triggers when the human operator confirms via feedback.',
    helpUrl: '',
  },
  {
    type: 'find_object_block',
    message0: 'EVENT: Find %1',
    args0: [
      {
        type: 'input_value',
        name: 'OBJECT',
        check: 'object_block',
      },
    ],
    output: 'find_object_block',
    colour: blocksColours.eventsConditions,
    tooltip: 'Searches for the specified object using the robot vision system.',
    helpUrl: '',
  },
])

Blockly.defineBlocksWithJsonArray([
  {
    type: 'pick_block',
    message0: 'ROBOT: Pick %1',
    args0: [
      {
        type: 'input_value',
        name: 'OBJECT',
        check: 'object_block',
      },
    ],
    previousStatement: 'logic_pick_rel',
    nextStatement: ['pick_place_rel', 'pick_processing_rel'],
    colour: blocksColours.robotActions,
    tooltip: 'Robot picks up the specified object.',
    helpUrl: '',
  },
  {
    type: 'place_block',
    message0: 'ROBOT: Place %1',
    args0: [
      {
        type: 'input_value',
        name: 'LOCATION',
        check: 'location_block',
      },
    ],
    previousStatement: [
      'pick_place_rel',
      'processing_place_rel',
      'when_otherwise_place_rel',
    ],
    colour: blocksColours.robotActions,
    tooltip: 'Robot places the held object at the specified location.',
    helpUrl: '',
  },
  {
    type: 'processing_block',
    message0: 'ROBOT: Process %1',
    args0: [
      {
        type: 'input_value',
        name: 'ACTION',
        check: 'action_block',
      },
    ],
    previousStatement: ['pick_processing_rel', 'processing_processing_rel'],
    nextStatement: [
      'processing_place_rel',
      'processing_processing_rel',
      'processing_when_otherwise_rel',
    ],
    colour: blocksColours.robotActions,
    tooltip: 'Robot performs the specified processing action.',
    helpUrl: '',
  },
])

Blockly.defineBlocksWithJsonArray([
  {
    type: 'wait_for_human_block',
    message0: 'HUMAN: Wait for human to %1',
    args0: [
      {
        type: 'field_input',
        name: 'TASK_DESCRIPTION',
        text: 'insert component',
      },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: blocksColours.humanActions,
    tooltip: 'Pauses the robot sequence until human confirmation.',
    helpUrl: '',
  },
])

Blockly.defineBlocksWithJsonArray([
  {
    type: 'repeat_block',
    message0: 'CTRL: Repeat %1 times',
    args0: [
      {
        type: 'field_number',
        name: 'times',
        value: 2,
        min: 1,
        max: 99,
        precision: 1,
      },
    ],
    message1: '%1',
    args1: [
      {
        type: 'input_statement',
        name: 'DO',
        check: ['logic_pick_rel', 'logic_logic_rel'],
      },
    ],
    previousStatement: 'logic_logic_rel',
    nextStatement: 'logic_logic_rel',
    colour: blocksColours.logicControl,
    tooltip: 'Repeats the contained steps a specified number of times.',
    helpUrl: '',
  },
  {
    type: 'loop_block',
    message0: 'CTRL: Loop',
    message1: '%1',
    args1: [
      {
        type: 'input_statement',
        name: 'DO',
        check: ['logic_pick_rel', 'logic_logic_rel'],
      },
    ],
    previousStatement: 'logic_logic_rel',
    nextStatement: 'logic_logic_rel',
    colour: blocksColours.logicControl,
    tooltip: 'Repeats the contained steps indefinitely.',
    helpUrl: '',
  },
  {
    type: 'when_block',
    message0: 'CTRL: When %1',
    args0: [
      {
        type: 'input_value',
        name: 'WHEN',
        check: [
          'find_object_block',
          'sensor_signal_block',
          'human_feedback_block',
        ],
      },
    ],
    message1: 'Do %1',
    args1: [
      {
        type: 'input_statement',
        name: 'DO',
        check: ['logic_pick_rel', 'logic_logic_rel'],
      },
    ],
    previousStatement: 'logic_logic_rel',
    nextStatement: 'logic_logic_rel',
    colour: blocksColours.logicControl,
    tooltip: 'Executes the contained steps when the condition is true.',
    helpUrl: '',
  },
  {
    type: 'when_otherwise_block',
    message0: 'CTRL: When %1',
    args0: [
      {
        type: 'input_value',
        name: 'WHEN',
        check: [
          'find_object_block',
          'sensor_signal_block',
          'human_feedback_block',
        ],
      },
    ],
    message1: 'Do %1',
    args1: [
      {
        type: 'input_statement',
        name: 'DO',
        check: [
          'logic_pick_rel',
          'logic_logic_rel',
          'when_otherwise_place_rel',
        ],
      },
    ],
    message2: 'Otherwise %1',
    args2: [
      {
        type: 'input_statement',
        name: 'OTHERWISE',
        check: [
          'logic_pick_rel',
          'logic_logic_rel',
          'when_otherwise_place_rel',
        ],
      },
    ],
    previousStatement: ['logic_logic_rel', 'processing_when_otherwise_rel'],
    nextStatement: 'logic_logic_rel',
    colour: blocksColours.logicControl,
    tooltip:
      'If-then-else: executes "Do" when condition is true, "Otherwise" when false.',
    helpUrl: '',
  },
])
