import { ActionListType } from 'pages/actions/types'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { AbstractCondition, AbstractStep } from 'pages/tasks/types'

/**
 * Parser for bidirectional conversion between Blockly blocks and abstract task representation.
 *
 * BLOCK SUPPORT STATUS:
 * ✅ FULLY SUPPORTED (in both abstractToBlockly and blocklyToAbstract):
 *    - pick, place, processing, move_to, gripper, repeat, when, human_action
 *
 * ⚠️  FRONTEND ONLY (Blockly UI exists, but not saved to backend):
 *    - loop_block: infinite loop (would need backend support)
 *    - repeat_until_block: conditional loop (would need AbstractRepeatUntilStep)
 *    - notify_action_block: non-blocking message (would need backend support)
 *
 * These UI-only blocks return null when blocklyToAbstract is called.
 */

/**
 * Converts an abstract task step sequence into a Blockly-compatible serialized block tree.
 *
 * The output is rooted at the first top-level executable block and can be appended
 * directly through Blockly serialization APIs.
 */
export const abstractToBlockly = (
  abstractTask: AbstractStep[],
  dataObjects: ObjectListType[],
  dataLocations: LocationListType[],
  dataActions: ActionListType[],
) => {
  const stepToBlock = (step: AbstractStep): any => {
    switch (step.type) {
      case 'pick': {
        const object = dataObjects.find((obj) => obj.id === step.objectId)
        return {
          type: 'pick_block',
          inputs: {
            OBJECT: {
              block: {
                type: 'object_block',
                data: JSON.stringify({
                  blocklyId: step?.objectId || '',
                  blocklyName: step?.objectName || '',
                  id: object?.id,
                  name: object?.name,
                  keywords: object?.keywords.join(',') || '',
                }),
                fields: { name: object?.name || step.objectName },
              },
            },
          },
        }
      }
      case 'place': {
        const location = dataLocations.find((loc) => loc.id === step.locationId)
        return {
          type: 'place_block',
          inputs: {
            LOCATION: {
              block: {
                type: 'location_block',
                data: JSON.stringify({
                  blocklyId: step?.locationId || '',
                  blocklyName: step?.locationName || '',
                  id: location?.id,
                  name: location?.name,
                  keywords: location?.keywords.join(',') || '',
                }),
                fields: { name: location?.name || step.locationName },
              },
            },
          },
        }
      }
      case 'processing': {
        const action = dataActions.find((act) => act.id === step.actionId)
        return {
          type: 'processing_block',
          inputs: {
            ACTION: {
              block: {
                type: 'action_block',
                data: JSON.stringify({
                  blocklyId: step?.actionId || '',
                  blocklyName: step?.actionName || '',
                  id: action?.id,
                  name: action?.name,
                  keywords: action?.keywords.join(',') || '',
                }),
                fields: { name: action?.name || step.actionName },
              },
            },
          },
        }
      }
      case 'move_to': {
        const location = dataLocations.find((loc) => loc.id === step.locationId)
        return {
          type: 'move_to_block',
          fields: { MOTION_TYPE: step.motionType || 'LINEAR' },
          inputs: {
            LOCATION: {
              block: {
                type: 'location_block',
                data: JSON.stringify({
                  blocklyId: step?.locationId || '',
                  blocklyName: step?.locationName || '',
                  id: location?.id,
                  name: location?.name,
                  keywords: location?.keywords?.join(',') || '',
                }),
                fields: { name: location?.name || step.locationName },
              },
            },
          },
        }
      }
      case 'gripper':
        return {
          type: 'gripper_block',
          fields: { GRIPPER_STATE: step.state || 'CLOSE' },
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
      case 'human_action':
        return {
          type: 'human_action_block',
          fields: {
            TASK_DESC: step.description || 'insert component',
          },
          inputs: {
            CONFIRM_EVENT: { block: conditionToBlock(step.confirmEvent) },
          },
        }
      default:
        return null
    }
  }

  const stepsToSequence = (steps: AbstractStep[]) => {
    if (!steps.length) return null
    const [first, ...rest] = steps
    const block = stepToBlock(first)
    if (!block) return null
    if (rest.length) {
      const nextBlock = stepsToSequence(rest)
      if (nextBlock) {
        block.next = { block: nextBlock }
      }
    }
    return block
  }

  const conditionToBlock = (condition: AbstractCondition | null) => {
    if (!condition) return null
    switch (condition.type) {
      case 'sensor_signal':
        if (!condition.sensor) return null
        switch (condition.sensor) {
          case 'camera':
            return {
              type: 'sensor_signal_block',
              fields: { sensor: 'Camera sensor signal' },
              data: JSON.stringify({ sensor: condition.sensor }),
            }
          case 'ir':
            return {
              type: 'sensor_signal_block',
              fields: { sensor: 'IR sensor signal' },
              data: JSON.stringify({ sensor: condition.sensor }),
            }
        }
        return {
          type: 'sensor_signal_block',
          fields: { sensor: condition.sensor },
          data: JSON.stringify({ sensor: condition.sensor }),
        }
      case 'find_object': {
        const object = dataObjects.find((obj) => obj.id === condition.objectId)
        return {
          type: 'find_object_block',
          inputs: {
            OBJECT: {
              block: {
                type: 'object_block',
                data: JSON.stringify({
                  blocklyId: condition?.objectId || '',
                  blocklyName: condition?.objectName || '',
                  id: object?.id,
                  name: object?.name,
                  keywords: object?.keywords.join(',') || '',
                }),
                fields: { name: object?.name || condition?.objectName },
              },
            },
          },
        }
      }
      case 'touch_detect':
        return { type: 'touch_detect_block' }
      case 'gesture':
        return {
          type: 'gesture_block',
          fields: { GESTURE_TYPE: condition.gestureType || 'THUMBS_UP' },
        }
      case 'timer':
        return {
          type: 'timer_block',
          fields: { SECONDS: condition.seconds || 5 },
        }
      case 'human_feedback':
        return { type: 'human_feedback_block' }
      default:
        return null
    }
  }

  return {
    ...stepsToSequence(abstractTask),
  }
}

// ---------------------------------------------
// EXTENDED CUSTOM BLOCK INTERFACE
// ---------------------------------------------
export interface CustomBlock {
  id?: string
  type:
    | 'object_block'
    | 'location_block'
    | 'action_block'
    | 'pick_block'
    | 'place_block'
    | 'processing_block'
    | 'move_to_block'
    | 'gripper_block'
    | 'repeat_block'
    | 'loop_block'
    | 'repeat_until_block'
    | 'when_block'
    | 'when_otherwise_block'
    | 'sensor_signal_block'
    | 'find_object_block'
    | 'touch_detect_block'
    | 'gesture_block'
    | 'timer_block'
    | 'human_feedback_block'
    | 'human_action_block'
    | 'notify_action_block'
    | 'wait_for_human_block' // kept for backwards compatibility
  inputs?: {
    OBJECT?: { block: CustomBlock }
    LOCATION?: { block: CustomBlock }
    ACTION?: { block: CustomBlock }
    DO?: { block: CustomBlock }
    WHEN?: { block: CustomBlock }
    CONDITION?: { block: CustomBlock }
    OTHERWISE?: { block: CustomBlock }
    CONFIRM_EVENT?: { block: CustomBlock }
  }
  data?: string
  extraState?: string
  fields?: {
    times?: number
    name?: string
    TASK_DESCRIPTION?: string
    TASK_DESC?: string
    MOTION_TYPE?: 'LINEAR' | 'JOINT'
    AXIS?: 'X' | 'Y' | 'Z'
    DISTANCE?: number
    GRIPPER_STATE?: 'OPEN' | 'CLOSE'
    GESTURE_TYPE?: 'THUMBS_UP' | 'STOP' | 'OPEN_HAND'
    SECONDS?: number
  }
  next?: { block: CustomBlock }
}

/**
 * Converts a Blockly serialized block tree to the AbstractStep representation
 * used by task APIs and chat workflows.
 */
export const blocklyToAbstract = (
  blocklyRoot: CustomBlock | null,
): AbstractStep[] | null => {
  if (!blocklyRoot) return null

  const blockToStep = (block: CustomBlock): AbstractStep | null => {
    switch (block.type) {
      case 'pick_block':
        return {
          type: 'pick',
          objectId: getIdFromBlock(block.inputs?.OBJECT?.block),
          objectName: getNameFromBlock(block.inputs?.OBJECT?.block),
        }
      case 'place_block':
        return {
          type: 'place',
          locationId: getIdFromBlock(block.inputs?.LOCATION?.block),
          locationName: getNameFromBlock(block.inputs?.LOCATION?.block),
        }
      case 'processing_block':
        return {
          type: 'processing',
          actionId: getIdFromBlock(block.inputs?.ACTION?.block) || '',
          actionName: getNameFromBlock(block.inputs?.ACTION?.block) || '',
        }
      case 'move_to_block':
        return {
          type: 'move_to',
          motionType: block.fields?.MOTION_TYPE || 'LINEAR',
          locationId: getIdFromBlock(block.inputs?.LOCATION?.block),
          locationName: getNameFromBlock(block.inputs?.LOCATION?.block),
        }
      case 'gripper_block':
        return {
          type: 'gripper',
          state: block.fields?.GRIPPER_STATE || 'CLOSE',
        }
      case 'repeat_block':
        return {
          type: 'repeat',
          times: block.fields?.times ?? 1,
          steps: sequenceToSteps(block.inputs?.DO?.block),
        }
      case 'loop_block':
        // loop_block is not yet supported in AbstractStep (infinite loop)
        // Return null until backend supports this pattern
        return null
      case 'repeat_until_block':
        // repeat_until_block is not yet supported in AbstractStep
        // Would need AbstractRepeatUntilStep type in backend
        return null
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
      case 'human_action_block':
        return {
          type: 'human_action',
          description: block.fields?.TASK_DESC || '',
          confirmEvent: blockToCondition(block.inputs?.CONFIRM_EVENT?.block),
        }
      case 'notify_action_block':
        // notify_action_block is not yet supported in AbstractStep
        // It's a non-blocking notification that doesn't pause the robot
        return null

      default:
        return null
    }
  }

  const sequenceToSteps = (block: CustomBlock | undefined): AbstractStep[] => {
    const steps: AbstractStep[] = []
    let current = block
    while (current) {
      const step = blockToStep(current)
      if (step) steps.push(step)
      current = current.next?.block
    }
    return steps
  }

  const getIdFromBlock = (block: CustomBlock | undefined) => {
    if (!block) return ''
    try {
      if (block.data) {
        const data = JSON.parse(block.data)
        return data.id ?? null
      }
      return block.fields?.name ?? ''
    } catch {
      return block.fields?.name ?? ''
    }
  }

  const getNameFromBlock = (block: CustomBlock | undefined) => {
    if (!block) return ''
    try {
      if (block.data) {
        const data = JSON.parse(block.data)
        return data.name ?? null
      }
      return block.fields?.name ?? ''
    } catch {
      return block.fields?.name ?? ''
    }
  }

  const blockToCondition = (
    block: CustomBlock | undefined,
  ): AbstractCondition | null => {
    if (!block) return null
    switch (block.type) {
      case 'sensor_signal_block': {
        if (!block.data) return null
        const data = JSON.parse(block.data)
        return { type: 'sensor_signal', sensor: data.sensor }
      }
      case 'find_object_block':
        return {
          type: 'find_object',
          objectId: getIdFromBlock(block.inputs?.OBJECT?.block),
          objectName: getNameFromBlock(block.inputs?.OBJECT?.block),
        }
      case 'touch_detect_block':
        return { type: 'touch_detect' }
      case 'gesture_block':
        return {
          type: 'gesture',
          gestureType: (block.fields?.GESTURE_TYPE || 'THUMBS_UP') as 'THUMBS_UP' | 'STOP',
        }
      case 'timer_block':
        return {
          type: 'timer',
          seconds: block.fields?.SECONDS ?? 5,
        }
      case 'human_feedback_block':
        return { type: 'human_feedback' }
      case 'notify_action_block':
        // notify_action_block doesn't produce a condition
        return null
      default:
        return null
    }
  }

  return sequenceToSteps(blocklyRoot)
}
