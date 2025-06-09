//Object.defineProperty(exports, "__esModule", { value: true });
//exports.blocklyToAbstract = exports.abstractToBlockly = void 0;
/**
 * Converts an AbstractTask to a Blockly JSON model.
 * @param abstractTask The abstract task model
 * @returns Blockly JSON model (root block)
 */
export const abstractToBlockly = (abstractTask) => {
  // Helper to recursively convert steps
  const stepToBlock = (step) => {
    switch (step.type) {
      case 'pick':
        return {
          type: 'pick_block',
          inputs: {
            OBJECT: {
              block: {
                type: 'object_block',
                data: JSON.stringify({ id: step.object }),
                fields: { name: step.object },
              },
            },
          },
        }
      case 'place':
        return {
          type: 'place_block',
          inputs: {
            LOCATION: {
              block: {
                type: 'location_block',
                data: JSON.stringify({ id: step.location }),
                fields: { name: step.location },
              },
            },
          },
        }
      case 'processing':
        return {
          type: 'processing_block',
          inputs: {
            ACTION: {
              block: {
                type: 'action_block',
                data: JSON.stringify({ id: step.action }),
                fields: { name: step.action },
              },
            },
          },
        }
      case 'repeat':
        return {
          type: 'repeat_block',
          fields: { times: step.times },
          inputs: { DO: { block: stepsToSequence(step.steps) } },
        }
      case 'when':
        return {
          type: step.otherwise ? 'when_otherwise_block' : 'when_block',
          inputs: {
            WHEN: { block: conditionToBlock(step.condition) },
            DO: { block: stepsToSequence(step.do) },
            ...(step.otherwise
              ? { OTHERWISE: { block: stepsToSequence(step.otherwise) } }
              : {}),
          },
        }
      default:
        return null
    }
  }
  // Helper to convert a sequence of steps into a linked block list
  const stepsToSequence = (steps) => {
    if (!steps.length) return null
    const [first, ...rest] = steps
    const block = stepToBlock(first)
    if (rest.length) {
      block.next = { block: stepsToSequence(rest) }
    }
    return block
  }
  // Helper to convert condition
  const conditionToBlock = (condition) => {
    switch (condition.type) {
      case 'sensor_signal':
        return { type: 'sensor_signal_block' }
      case 'find_object':
        return {
          type: 'find_object_block',
          inputs: {
            OBJECT: {
              block: {
                type: 'object_block',
                data: JSON.stringify({ id: condition.object }),
                fields: { name: condition.object },
              },
            },
          },
        }
      case 'human_feedback':
        return { type: 'human_feedback_block' }
      default:
        return null
    }
  }
  // Root: wrap steps in a root block if needed, or just return the sequence
  return stepsToSequence(abstractTask.steps)
}
//exports.abstractToBlockly = abstractToBlockly;
/**
 * Converts a Blockly JSON model to an AbstractTask.
 * @param blocklyRoot The root block of the Blockly JSON model
 * @returns AbstractTask
 */
export const blocklyToAbstract = (blocklyRoot) => {
  // Helper to recursively convert blocks to steps
  const blockToStep = (block) => {
    if (!block) return null
    switch (block.type) {
      case 'pick_block':
        return {
          type: 'pick',
          object: getIdFromBlock(block.inputs?.OBJECT?.block),
        }
      case 'place_block':
        return {
          type: 'place',
          location: getIdFromBlock(block.inputs?.LOCATION?.block),
        }
      case 'processing_block':
        return {
          type: 'processing',
          action: getIdFromBlock(block.inputs?.ACTION?.block),
        }
      case 'repeat_block':
        return {
          type: 'repeat',
          times: block.fields?.times ?? 1,
          steps: sequenceToSteps(block.inputs?.DO?.block),
        }
      case 'when_block':
        return {
          type: 'when',
          condition: blockToCondition(block.inputs?.WHEN?.block),
          do: sequenceToSteps(block.inputs?.DO?.block),
        }
      case 'when_otherwise_block':
        return {
          type: 'when',
          condition: blockToCondition(block.inputs?.WHEN?.block),
          do: sequenceToSteps(block.inputs?.DO?.block),
          otherwise: sequenceToSteps(block.inputs?.OTHERWISE?.block),
        }
      default:
        return null
    }
  }
  // Helper to convert a linked block list to an array of steps
  const sequenceToSteps = (block) => {
    const steps: any[] = []
    let current = block
    while (current) {
      const step = blockToStep(current)
      if (step) steps.push(step)
      current = current.next?.block
    }
    return steps
  }
  // Helper to extract object/action/location ID from block
  const getIdFromBlock = (block) => {
    if (!block) return ''
    try {
      if (block.data) {
        const data = JSON.parse(block.data)
        return data.id?.toString() ?? ''
      }
      return block.fields?.name ?? ''
    } catch {
      return block.fields?.name ?? ''
    }
  }
  // Helper to convert condition block
  const blockToCondition = (block) => {
    if (!block) return null
    switch (block.type) {
      case 'sensor_signal_block':
        return { type: 'sensor_signal', sensor: 'camera' } // or extract sensor if available
      case 'find_object_block':
        return {
          type: 'find_object',
          object: getIdFromBlock(block.inputs?.OBJECT?.block),
        }
      case 'human_feedback_block':
        return { type: 'human_feedback' }
      default:
        return null
    }
  }
  // Compose the AbstractTask
  return {
    taskName: 'Imported from Blockly',
    steps: sequenceToSteps(blocklyRoot),
  }
}
//exports.blocklyToAbstract = blocklyToAbstract;
