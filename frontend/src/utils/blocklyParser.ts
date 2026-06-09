import { ActionListType } from 'pages/actions/types'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { AbstractCondition, AbstractStep } from 'pages/tasks/types'

/**
 * Parser for bidirectional conversion between Blockly blocks and abstract task representation.
 *
 * BLOCK SUPPORT STATUS:
 *  FULLY SUPPORTED:
 *    - pick, place, processing, move_to, gripper, repeat, when, human_action
 *    - sensor_signal, find_object, touch_detect, gesture, timer
 *    - logic_and, logic_or, logic_not, human_feedback
 *
 *  FRONTEND ONLY (Blockly UI exists, not saved to backend):
 *    - loop_block: infinite loop (would need backend support)
 *    - repeat_until_block: conditional loop (would need AbstractRepeatUntilStep)
 *    - notify_action_block: non-blocking message (would need backend support)
 *
 * These UI-only blocks return null from blocklyToAbstract and are skipped in sequences.
 */

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
    | 'wait_block'
    | 'logic_and_block'
    | 'logic_or_block'
    | 'logic_not_block'
    | 'wait_for_human_block' // kept for backwards compatibility
    | 'when_start'
    | 'macro_task_block'
  inputs?: {
    OBJECT?: { block?: CustomBlock; shadow?: CustomBlock }
    LOCATION?: { block?: CustomBlock; shadow?: CustomBlock }
    ACTION?: { block?: CustomBlock; shadow?: CustomBlock }
    DO?: { block?: CustomBlock; shadow?: CustomBlock }
    WHEN?: { block?: CustomBlock; shadow?: CustomBlock }
    CONDITION?: { block?: CustomBlock; shadow?: CustomBlock }
    OTHERWISE?: { block?: CustomBlock; shadow?: CustomBlock }
    CONFIRM_EVENT?: { block?: CustomBlock; shadow?: CustomBlock }
    A?: { block?: CustomBlock; shadow?: CustomBlock }
    B?: { block?: CustomBlock; shadow?: CustomBlock }
    BOOL?: { block?: CustomBlock; shadow?: CustomBlock }
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
    sensor?: string
  }
  next?: { block: CustomBlock }
}

/**
 * Prefers a real block over a shadow block.
 * Handles Blockly's serialization where unconnected inputs appear as
 * { shadow: {...} } instead of { block: {...} }.
 */
const resolveBlock = (input?: {
  block?: CustomBlock
  shadow?: CustomBlock
}): CustomBlock | undefined => input?.block ?? input?.shadow

// ---------------------------------------------
// ABSTRACT → BLOCKLY
// ---------------------------------------------

/**
 * Converts an abstract task step sequence into a Blockly-compatible serialized block tree.
 * The output can be loaded directly via Blockly's serialization APIs.
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
                  id: object?.id ?? step.objectId ?? null,
                  name: object?.name ?? step.objectName ?? null,
                  keywords: object?.keywords?.join(',') ?? '',
                }),
                fields: { name: object?.name ?? step.objectName ?? '' },
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
                  id: location?.id ?? step.locationId ?? null,
                  name: location?.name ?? step.locationName ?? null,
                  keywords: location?.keywords?.join(',') ?? '',
                }),
                fields: { name: location?.name ?? step.locationName ?? '' },
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
                  id: action?.id ?? step.actionId ?? null,
                  name: action?.name ?? step.actionName ?? null,
                  keywords: action?.keywords?.join(',') ?? '',
                }),
                fields: { name: action?.name ?? step.actionName ?? '' },
              },
            },
          },
        }
      }
      case 'move_to': {
        const location = dataLocations.find((loc) => loc.id === step.locationId)
        return {
          type: 'move_to_block',
          fields: { MOTION_TYPE: step.motionType ?? 'LINEAR' },
          inputs: {
            LOCATION: {
              block: {
                type: 'location_block',
                data: JSON.stringify({
                  id: location?.id ?? step.locationId ?? null,
                  name: location?.name ?? step.locationName ?? null,
                  keywords: location?.keywords?.join(',') ?? '',
                }),
                fields: { name: location?.name ?? step.locationName ?? '' },
              },
            },
          },
        }
      }
      case 'gripper':
        return {
          type: 'gripper_block',
          fields: { GRIPPER_STATE: step.state ?? 'CLOSE' },
        }
      case 'wait':
        return {
          type: 'wait_block',
          fields: { SECONDS: (step as any).seconds ?? 3 },
        }
      case 'repeat': {
        const innerBlock = stepsToSequence(step.steps)
        return {
          type: 'repeat_block',
          fields: { times: step.times },
          inputs: innerBlock ? { DO: { block: innerBlock } } : { DO: {} },
        }
      }
      case 'repeat_until': {
        const condBlock = conditionToBlock(step.condition)
        const innerSteps = (step as any).do || step.steps
        const innerBlock = stepsToSequence(innerSteps)
        return {
          type: 'repeat_until_block',
          inputs: {
            CONDITION: condBlock ? { block: condBlock } : {},
            DO: innerBlock ? { block: innerBlock } : {},
          },
        }
      }
      case 'notify_action': {
        return {
          type: 'notify_action_block',
          fields: { TASK_DESC: step.description ?? '' },
        }
      }
      case 'when': {
        const condBlock = conditionToBlock(step.condition)
        const doBlock = stepsToSequence(step.do)
        const otherwiseBlock = step.otherwise
          ? stepsToSequence(step.otherwise)
          : null
        return {
          type: step.otherwise ? 'when_otherwise_block' : 'when_block',
          inputs: {
            WHEN: condBlock ? { block: condBlock } : {},
            DO: doBlock ? { block: doBlock } : {},
            ...(step.otherwise
              ? { OTHERWISE: otherwiseBlock ? { block: otherwiseBlock } : {} }
              : {}),
          },
        }
      }
      case 'human_action': {
        const confirmBlock = conditionToBlock(step.confirmEvent)
        return {
          type: 'human_action_block',
          fields: { TASK_DESC: step.description ?? '' },
          inputs: {
            CONFIRM_EVENT: confirmBlock ? { block: confirmBlock } : {},
          },
        }
      }
      default:
        return null
    }
  }

  const stepsToSequence = (steps: AbstractStep[]): any => {
    if (!steps || !steps.length) return null
    const [first, ...rest] = steps
    const block = stepToBlock(first)
    if (!block) return stepsToSequence(rest) // skip unsupported, try next
    if (rest.length) {
      const nextBlock = stepsToSequence(rest)
      if (nextBlock) block.next = { block: nextBlock }
    }
    return block
  }

  const conditionToBlock = (condition: AbstractCondition | null): any => {
    if (!condition) return null
    switch (condition.type) {
      case 'sensor_signal': {
        if (!condition.sensor) return null
        const labelMap: Record<string, string> = {
          camera: 'Camera sensor signal',
          ir: 'IR sensor signal',
        }
        return {
          type: 'sensor_signal_block',
          fields: { sensor: labelMap[condition.sensor] ?? condition.sensor },
          data: JSON.stringify({ sensor: condition.sensor }),
        }
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
                  id: object?.id ?? condition.objectId ?? null,
                  name: object?.name ?? condition.objectName ?? null,
                  keywords: object?.keywords?.join(',') ?? '',
                }),
                fields: { name: object?.name ?? condition.objectName ?? '' },
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
          fields: { GESTURE_TYPE: condition.gestureType ?? 'THUMBS_UP' },
        }
      case 'timer':
        return {
          type: 'timer_block',
          fields: { SECONDS: condition.seconds ?? 5 },
        }
      case 'and': {
        const left = conditionToBlock(condition.left)
        const right = conditionToBlock(condition.right)
        return {
          type: 'logic_and_block',
          inputs: {
            A: left ? { block: left } : {},
            B: right ? { block: right } : {},
          },
        }
      }
      case 'or': {
        const left = conditionToBlock(condition.left)
        const right = conditionToBlock(condition.right)
        return {
          type: 'logic_or_block',
          inputs: {
            A: left ? { block: left } : {},
            B: right ? { block: right } : {},
          },
        }
      }
      case 'not': {
        const inner = conditionToBlock(condition.condition)
        return {
          type: 'logic_not_block',
          inputs: { BOOL: inner ? { block: inner } : {} },
        }
      }
      case 'human_feedback':
        return { type: 'human_feedback_block' }
      default:
        return null
    }
  }

  return { ...stepsToSequence(abstractTask) }
}

// ---------------------------------------------
// BLOCKLY → ABSTRACT
// ---------------------------------------------

/**
 * Converts a Blockly serialized block tree to the AbstractStep representation
 * used by task APIs and chat workflows.
 */
export const blocklyToAbstract = (
  blocklyRoot: CustomBlock | null,
): AbstractStep[] | null => {
  if (!blocklyRoot) return null

  const getIdFromBlock = (block: CustomBlock | undefined): any => {
    if (!block) return null
    try {
      if (block.data) {
        const data = JSON.parse(block.data)
        return data.id ?? null
      }
    } catch {
      /* ignore */
    }
    return null
  }

  const getNameFromBlock = (block: CustomBlock | undefined): string => {
    if (!block) return ''
    try {
      if (block.data) {
        const data = JSON.parse(block.data)
        return data.name ?? block.fields?.name ?? ''
      }
    } catch {
      /* ignore */
    }
    return block.fields?.name ?? ''
  }

  const blockToCondition = (
    block: CustomBlock | undefined,
  ): AbstractCondition | null => {
    if (!block) return null
    switch (block.type) {
      case 'sensor_signal_block': {
        if (!block.data) return null
        try {
          const data = JSON.parse(block.data)
          return { type: 'sensor_signal', sensor: data.sensor }
        } catch {
          return null
        }
      }
      case 'find_object_block':
        return {
          type: 'find_object',
          objectId: getIdFromBlock(resolveBlock(block.inputs?.OBJECT)),
          objectName: getNameFromBlock(resolveBlock(block.inputs?.OBJECT)),
        }
      case 'touch_detect_block':
        return { type: 'touch_detect' }
      case 'gesture_block':
        return {
          type: 'gesture',
          gestureType: block.fields?.GESTURE_TYPE ?? 'THUMBS_UP',
        }
      case 'timer_block':
        return { type: 'timer', seconds: block.fields?.SECONDS ?? 5 }
      case 'logic_and_block': {
        const left = blockToCondition(resolveBlock(block.inputs?.A))
        const right = blockToCondition(resolveBlock(block.inputs?.B))
        if (!left || !right) return null
        return { type: 'and', left, right }
      }
      case 'logic_or_block': {
        const left = blockToCondition(resolveBlock(block.inputs?.A))
        const right = blockToCondition(resolveBlock(block.inputs?.B))
        if (!left || !right) return null
        return { type: 'or', left, right }
      }
      case 'logic_not_block': {
        const condition = blockToCondition(resolveBlock(block.inputs?.BOOL))
        if (!condition) return null
        return { type: 'not', condition }
      }
      case 'human_feedback_block':
        return { type: 'human_feedback' }
      case 'notify_action_block':
        return null
      default:
        return null
    }
  }

  const blockToStep = (block: CustomBlock): AbstractStep | null => {
    switch (block.type) {
      case 'pick_block':
        return {
          type: 'pick',
          objectId: getIdFromBlock(resolveBlock(block.inputs?.OBJECT)),
          objectName: getNameFromBlock(resolveBlock(block.inputs?.OBJECT)),
        }
      case 'place_block':
        return {
          type: 'place',
          locationId: getIdFromBlock(resolveBlock(block.inputs?.LOCATION)),
          locationName: getNameFromBlock(resolveBlock(block.inputs?.LOCATION)),
        }
      case 'processing_block':
        return {
          type: 'processing',
          actionId: getIdFromBlock(resolveBlock(block.inputs?.ACTION)) ?? '',
          actionName: getNameFromBlock(resolveBlock(block.inputs?.ACTION)),
        }
      case 'move_to_block':
        return {
          type: 'move_to',
          motionType: block.fields?.MOTION_TYPE ?? 'LINEAR',
          locationId: getIdFromBlock(resolveBlock(block.inputs?.LOCATION)),
          locationName: getNameFromBlock(resolveBlock(block.inputs?.LOCATION)),
        }
      case 'gripper_block':
        return {
          type: 'gripper',
          state: block.fields?.GRIPPER_STATE ?? 'CLOSE',
        }
      case 'wait_block':
        return {
          type: 'wait',
          seconds: Number(block.fields?.SECONDS ?? 3),
        } as any
      case 'repeat_block':
        return {
          type: 'repeat',
          times: block.fields?.times ?? 1,
          steps: sequenceToSteps(resolveBlock(block.inputs?.DO)),
        }
      case 'loop_block':
        // Frontend-only blocks — skip and continue sequence traversal via next
        return null
      case 'repeat_until_block':
        return {
          type: 'repeat_until',
          condition: blockToCondition(resolveBlock(block.inputs?.CONDITION)),
          do: sequenceToSteps(resolveBlock(block.inputs?.DO)),
          steps: sequenceToSteps(resolveBlock(block.inputs?.DO)),
        } as any
      case 'notify_action_block':
        return {
          type: 'notify_action',
          description: block.fields?.TASK_DESC ?? '',
        }
      case 'when_block':
        return {
          type: 'when',
          condition: blockToCondition(resolveBlock(block.inputs?.WHEN)),
          do: sequenceToSteps(resolveBlock(block.inputs?.DO)),
        }
      case 'when_otherwise_block':
        return {
          type: 'when',
          condition: blockToCondition(resolveBlock(block.inputs?.WHEN)),
          do: sequenceToSteps(resolveBlock(block.inputs?.DO)),
          otherwise: sequenceToSteps(resolveBlock(block.inputs?.OTHERWISE)),
        }
      case 'human_action_block':
        return {
          type: 'human_action',
          description: block.fields?.TASK_DESC ?? '',
          confirmEvent: blockToCondition(
            resolveBlock(block.inputs?.CONFIRM_EVENT),
          ),
        }
      case 'macro_task_block':
        return {
          type: 'macro_task',
          macroId: getIdFromBlock(block),
          macroName: getNameFromBlock(block),
        }
      case 'when_start':
        // when_start represents the start of a sequence but is not a step itself.
        // Returning null allows sequenceToSteps to skip it and parse its next connected blocks.
        return null
      default:
        return null
    }
  }

  const sequenceToSteps = (block: CustomBlock | undefined): AbstractStep[] => {
    const steps: AbstractStep[] = []
    let current: CustomBlock | undefined = block
    while (current) {
      const step = blockToStep(current)
      if (step) steps.push(step)
      current = current.next?.block
    }
    return steps
  }

  return sequenceToSteps(blocklyRoot)
}

/**
 * Converts multiple top-level Blockly blocks (or a single block) into a single flattened
 * AbstractStep list. Useful for parsing workspaces with multiple disconnected branches or standalone blocks.
 */
export const blocklyToAbstractAll = (
  blocks: CustomBlock[] | CustomBlock | null,
): import('pages/tasks/types').ASTBranch[] => {
  if (!blocks) return []
  const blockArray = Array.isArray(blocks) ? blocks : [blocks]
  const branches: import('pages/tasks/types').ASTBranch[] = []
  for (const block of blockArray) {
    const isMain = block.type === 'when_start'
    const steps = blocklyToAbstract(block)
    if (steps && steps.length > 0) {
      branches.push({ isMain, steps })
    }
  }
  return branches
}
