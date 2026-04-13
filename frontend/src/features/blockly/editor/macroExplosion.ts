import * as Blockly from 'blockly/core'

import { ActionListType } from 'pages/actions/types'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { TaskType } from 'pages/tasks/types'
import { abstractToBlockly } from 'utils/blocklyParser'
import { BlockState as State } from 'utils/blocklyTypes'
import { parseJson } from '../utils/serialization'

/**
 * Resolve the macro identifier from Blockly block metadata.
 */
export const getMacroIdFromBlockData = (rawData: unknown) => {
  if (typeof rawData !== 'string' || rawData.trim().length === 0) {
    return null
  }

  const parsedData = parseJson<{
    id?: number | string
    taskId?: number | string
  }>(rawData)

  const macroId = parsedData?.taskId ?? parsedData?.id
  if (macroId === undefined || macroId === null) {
    return null
  }

  const normalizedMacroId = `${macroId}`.trim()
  return normalizedMacroId.length > 0 ? normalizedMacroId : null
}

/**
 * Parse macro code payloads that may be stored as plain arrays or wrapped in a `steps` object.
 */
export const parseMacroSteps = (rawCode: string) => {
  if (typeof rawCode !== 'string' || rawCode.trim().length === 0) {
    return null
  }

  const parsedCode = parseJson<unknown>(rawCode)
  if (!parsedCode) {
    return null
  }

  if (Array.isArray(parsedCode)) {
    return parsedCode
  }

  if (
    typeof parsedCode === 'object' &&
    Array.isArray((parsedCode as { steps?: unknown }).steps)
  ) {
    return (parsedCode as { steps: unknown[] }).steps
  }

  return null
}

/**
 * Input required to replace a `macro_task_block` with its expanded block chain.
 */
interface ExplodeMacroParams {
  block: Blockly.BlockSvg
  workspace: Blockly.WorkspaceSvg
  dataMacros: TaskType[]
  dataObjects: ObjectListType[]
  dataLocations: LocationListType[]
  dataActions: ActionListType[]
}

/**
 * Replace a macro block with its concrete block sequence while preserving chain connections.
 */
export const explodeMacro = ({
  block,
  workspace,
  dataMacros,
  dataObjects,
  dataLocations,
  dataActions,
}: ExplodeMacroParams) => {
  if (!block || block.type !== 'macro_task_block') return

  const macroId = getMacroIdFromBlockData(block.data)
  if (!macroId) {
    return
  }

  const macro = dataMacros.find((task) => `${task.id}` === macroId)
  if (!macro) {
    return
  }

  const parsedCode = parseJson<any>(macro.code)
  if (!parsedCode) {
    return
  }

  let blockState: State | null = null

  if (
    Array.isArray(parsedCode) ||
    (parsedCode && Array.isArray(parsedCode.steps))
  ) {
    const abstractSteps = Array.isArray(parsedCode)
      ? parsedCode
      : parsedCode.steps
    blockState = abstractToBlockly(
      abstractSteps,
      dataObjects,
      dataLocations,
      dataActions,
    ) as State | null
  } else if (parsedCode && typeof parsedCode.type === 'string') {
    blockState = parsedCode
  }

  if (
    !blockState ||
    typeof blockState !== 'object' ||
    !(blockState as any).type
  ) {
    return
  }

  const prevConnection = block.previousConnection?.targetConnection ?? null
  const nextConnection = block.nextConnection?.targetConnection ?? null
  const xyCoordinates = block.getRelativeToSurfaceXY()

  const currentEventGroup = Blockly.Events.getGroup()
  if (!currentEventGroup) {
    Blockly.Events.setGroup(true)
  }

  try {
    if (block.nextConnection && block.nextConnection.targetConnection) {
      block.nextConnection.disconnect()
    }

    block.dispose(false)

    const newFirstBlock = Blockly.serialization.blocks.append(
      blockState,
      workspace,
    ) as Blockly.BlockSvg | null

    if (!newFirstBlock) {
      throw new Error('Blockly failed to render the block state.')
    }

    if (prevConnection && newFirstBlock.previousConnection) {
      prevConnection.connect(newFirstBlock.previousConnection)
    } else {
      newFirstBlock.moveTo(xyCoordinates)
    }

    let newLastBlock: Blockly.Block | null = newFirstBlock
    while (newLastBlock?.getNextBlock()) {
      newLastBlock = newLastBlock.getNextBlock()
    }

    if (nextConnection && newLastBlock?.nextConnection) {
      newLastBlock.nextConnection.connect(nextConnection)
    }
  } finally {
    if (!currentEventGroup) {
      Blockly.Events.setGroup(false)
    }
  }
}
