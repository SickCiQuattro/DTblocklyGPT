import { ActionListType } from 'pages/actions/types'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { AbstractCondition, AbstractStep } from 'pages/tasks/types'

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
      case 'wait_for_human':
        return {
          type: 'wait_for_human_block',
          fields: {
            TASK_DESCRIPTION: step.description || 'insert component',
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
    | 'repeat_block'
    | 'when_block'
    | 'when_otherwise_block'
    | 'sensor_signal_block'
    | 'find_object_block'
    | 'human_feedback_block'
    | 'wait_for_human_block'
  inputs?: {
    OBJECT?: { block: CustomBlock }
    LOCATION?: { block: CustomBlock }
    ACTION?: { block: CustomBlock }
    DO?: { block: CustomBlock }
    WHEN?: { block: CustomBlock }
    OTHERWISE?: { block: CustomBlock }
  }
  data?: string
  extraState?: string
  fields?: {
    times?: number
    name?: string
    TASK_DESCRIPTION?: string
  }
  next?: { block: CustomBlock }
}

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
      case 'wait_for_human_block':
        return {
          type: 'wait_for_human',
          description: block.fields?.TASK_DESCRIPTION || '',
        }

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
      case 'human_feedback_block':
        return { type: 'human_feedback' }
      default:
        return null
    }
  }

  return sequenceToSteps(blocklyRoot)
}
