import * as Blockly from 'blockly/core'

export const blocksColours = {
  // Mockup palette
  logics: '#988473',
  steps: '#2955D9',
  human: '#FF8500',
  events: '#F24E1F',
  predefined: '#0098FB',
  // Backward-compatible aliases used by existing categories/blocks
  objects: '#0098FB',
  locations: '#0098FB',
  actions: '#0098FB',
}

// Google Groups thread: https://groups.google.com/g/blockly/c/0Xg9_Jlrey4

Blockly.Blocks.object_block = {
  init() {
    this.appendDummyInput().appendField(
      new Blockly.FieldLabelSerializable(''),
      'name',
    )
    this.setOutput(true, 'object_block')
    this.setColour(blocksColours.predefined)
    this.setWarningText('defaultWarningText')
  },

  // Mutators: https://developers.google.com/blockly/guides/create-custom-blocks/extensions#serialization_hooks
  mutationToDom() {
    const data = JSON.parse(this.data)
    this.setTooltip(
      data?.keywords ? `Keywords: ${data.keywords.replace(',', ', ')}` : '',
    )
    this.setWarningText(data?.id ? null : 'Object not defined')
  },
  saveExtraState() {},
}

Blockly.Blocks.location_block = {
  init() {
    this.appendDummyInput().appendField(
      new Blockly.FieldLabelSerializable(''),
      'name',
    )
    this.setOutput(true, 'location_block')
    this.setColour(blocksColours.predefined)
    this.setWarningText('defaultWarningText')
  },

  mutationToDom() {
    const data = JSON.parse(this.data)
    this.setTooltip(
      data?.keywords ? `Keywords: ${data.keywords.replace(',', ', ')}` : '',
    )
    this.setWarningText(data?.id ? null : 'Location not defined')
  },
  saveExtraState() {},
}

Blockly.Blocks.action_block = {
  init() {
    this.appendDummyInput().appendField(
      new Blockly.FieldLabelSerializable(''),
      'name',
    )
    this.setOutput(true, 'action_block')
    this.setColour(blocksColours.predefined)
    this.setWarningText('defaultWarningText')
  },

  mutationToDom() {
    const data = JSON.parse(this.data)
    this.setTooltip(
      data?.keywords ? `Keywords: ${data.keywords.replace(',', ', ')}` : '',
    )
    this.setWarningText(data?.id ? null : 'Action not defined')
  },
  saveExtraState() {},
}

/* Blockly.Blocks.detect_block = {
  init() {
    this.appendDummyInput().appendField('Detect other object')
    this.setOutput(true, 'detect_block')
    this.setColour(blocksColours.events)
  },
} */

Blockly.Blocks.sensor_signal_block = {
  init() {
    this.appendDummyInput().appendField(
      new Blockly.FieldLabelSerializable(''),
      'sensor',
    )
    this.setOutput(true, 'sensor_signal_block')
    this.setColour(blocksColours.events)
  },
}

Blockly.Blocks.human_feedback_block = {
  init() {
    this.appendDummyInput().appendField('Human feedback')
    this.setOutput(true, 'human_feedback_block')
    this.setColour(blocksColours.human)
  },
}

Blockly.Blocks.find_object_block = {
  init() {
    this.appendValueInput('OBJECT').setCheck('object_block').appendField('Find')
    this.setOutput(true, 'find_object_block')
    this.setColour(blocksColours.events)
  },
}

Blockly.Blocks.pick_block = {
  init() {
    this.appendDummyInput().appendField('Pick')
    this.appendValueInput('OBJECT').setCheck('object_block')
    this.appendDummyInput()
    this.setPreviousStatement(true, ['logic_pick_rel', 'place_pick_rel'])
    this.setNextStatement(true, ['pick_place_rel', 'pick_processing_rel'])
    this.setColour(blocksColours.steps)
  },
}

Blockly.Blocks.place_block = {
  init() {
    this.appendDummyInput().appendField('Place')
    this.appendValueInput('LOCATION').setCheck('location_block')
    this.appendDummyInput()
    this.setPreviousStatement(true, [
      'pick_place_rel',
      'processing_place_rel',
      'when_otherwise_place_rel',
    ])
    this.setNextStatement(true, [
      'place_repeat_rel',
      'place_when_rel',
      'place_when_otherwise_rel',
      'place_pick_rel',
    ])
    this.setColour(blocksColours.steps)
  },
}

Blockly.Blocks.processing_block = {
  init() {
    this.appendDummyInput().appendField('Processing')
    this.appendValueInput('ACTION').setCheck('action_block')
    this.appendDummyInput()
    this.setNextStatement(true, [
      'processing_place_rel',
      'processing_processing_rel',
      'processing_when_otherwise_rel',
    ])
    this.setPreviousStatement(true, [
      'pick_processing_rel',
      'processing_processing_rel',
      'logic_processing_rel',
    ])
    this.setColour(blocksColours.steps)
  },
}

/*
Blockly.Blocks.loop_block = {
  init() {
    this.appendDummyInput().appendField('Loop')
    this.appendStatementInput('DO').setCheck([
      'logic_pick_rel',
      'logic_logic_rel',
    ])
    this.setPreviousStatement(true, 'logic_logic_rel')
    this.setNextStatement(true, 'logic_logic_rel')
    this.setColour(blocksColours.logics)
  },
}
  */

Blockly.Blocks.when_otherwise_block = {
  init() {
    this.appendDummyInput().appendField('When')
    this.appendValueInput('WHEN').setCheck([
      'find_object_block',
      // 'detect_block',
      'sensor_signal_block',
      'human_feedback_block',
    ])
    this.appendStatementInput('DO')
      .setCheck([
        'logic_pick_rel',
        'logic_logic_rel',
        'when_otherwise_place_rel',
      ])
      .appendField('Do')
    this.appendDummyInput()
    this.appendStatementInput('OTHERWISE')
      .setCheck([
        'logic_pick_rel',
        'logic_logic_rel',
        'when_otherwise_place_rel',
      ])
      .appendField('Otherwise')
    this.setPreviousStatement(true, [
      'logic_logic_rel',
      'processing_when_otherwise_rel',
      'place_when_otherwise_rel',
      'logic_processing_rel',
    ])
    this.setNextStatement(true, [
      'logic_logic_rel',
      'logic_pick_rel',
      'logic_processing_rel',
    ])
    this.setColour(blocksColours.logics)
  },
}

Blockly.Blocks.when_block = {
  init() {
    this.appendDummyInput().appendField('When')
    this.appendValueInput('WHEN').setCheck([
      'find_object_block',
      // 'detect_block',
      'sensor_signal_block',
      'human_feedback_block',
    ])
    this.appendStatementInput('DO')
      .setCheck(['logic_pick_rel', 'logic_logic_rel'])
      .appendField('Do')
    this.setPreviousStatement(true, ['logic_logic_rel', 'place_when_rel'])
    this.setNextStatement(true, [
      'logic_logic_rel',
      'logic_pick_rel',
      'logic_processing_rel',
    ])
    this.setColour(blocksColours.logics)
  },
}

/* Blockly.Blocks.stop_when_block = {
  init() {
    this.appendDummyInput().appendField('Stop when')
    this.appendValueInput('STOP_WHEN').setCheck([
      'find_object_block',
      // 'detect_block',
      'sensor_signal_block',
      'human_feedback_block',
    ])
    this.appendStatementInput('DO')
      .setCheck(['logic_pick_rel', 'logic_logic_rel'])
      .appendField('Do')
    this.setPreviousStatement(true, 'logic_logic_rel')
    this.setNextStatement(true, 'logic_logic_rel')
    this.setColour(blocksColours.logics)
  },
} */

/* Blockly.Blocks.do_when_block = {
  init() {
    this.appendStatementInput('DO')
      .setCheck(['logic_pick_rel', 'logic_logic_rel'])
      .appendField('Do')
    this.appendDummyInput().appendField('When')
    this.appendValueInput('WHEN').setCheck([
      'find_object_block',
      // 'detect_block',
      'sensor_signal_block',
      'human_feedback_block',
    ])
    this.setPreviousStatement(true, 'logic_logic_rel')
    this.setNextStatement(true, 'logic_logic_rel')
    this.setColour(blocksColours.logics)
  },
} */

Blockly.Blocks.repeat_block = {
  init() {
    this.appendDummyInput()
      .appendField('Repeat')
      .appendField(new Blockly.FieldNumber(2, 1, 99, 1), 'times')
      .appendField('times')
    this.appendStatementInput('DO')
      .setCheck(['logic_pick_rel', 'logic_logic_rel'])
      .appendField('Do')
    this.setPreviousStatement(true, ['logic_logic_rel', 'place_repeat_rel'])
    this.setNextStatement(true, [
      'logic_logic_rel',
      'logic_pick_rel',
      'logic_processing_rel',
    ])
    this.setColour(blocksColours.logics)
  },
}
