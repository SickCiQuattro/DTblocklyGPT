/**
 * macroExplosion.ts
 *
 * Implements the "Break into steps" operation: replaces a `macro_task_block` with the
 * full block chain it encodes, inserting the expanded blocks at the same position
 * in the statement sequence.
 *
 * Exported helpers:
 *  - `explodeMacro`           — main entry point; expands a macro block in-place.
 *  - `getMacroIdFromBlockData` — reads the macro ID from a block's serialised `data`.
 */
import * as Blockly from 'blockly/core'

import { ActionListType } from 'pages/actions/types'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { TaskType } from 'pages/tasks/types'
import { abstractToBlockly } from 'utils/blocklyParser'
import { BlockState as State } from 'utils/blocklyTypes'
import { parseJson } from '../utils/serialization'

type WorkspaceSnapshot = Record<string, unknown>

const MACRO_EXCLUDED_TYPES = new Set([
  'when_start',
  'shadow_start_sequence_block',
])

const cloneWorkspaceSnapshot = (
  snapshot: WorkspaceSnapshot,
): WorkspaceSnapshot => {
  if (typeof structuredClone === 'function') {
    return structuredClone(snapshot)
  }

  return JSON.parse(JSON.stringify(snapshot)) as WorkspaceSnapshot
}

const saveWorkspaceSnapshot = (
  workspace: Blockly.WorkspaceSvg,
): WorkspaceSnapshot => {
  return cloneWorkspaceSnapshot(
    Blockly.serialization.workspaces.save(workspace) as WorkspaceSnapshot,
  )
}

const hasMacroStepsArray = (value: unknown): value is { steps: unknown[] } => {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { steps?: unknown }).steps)
  )
}

const isBlockStateLike = (value: unknown): value is State => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

const stripStartBlock = (state: State): State | null => {
  if (!MACRO_EXCLUDED_TYPES.has(state.type as string)) {
    return state
  }

  let current: State | null =
    (state.next as { block?: State } | undefined)?.block ?? null

  while (current && MACRO_EXCLUDED_TYPES.has(current.type as string)) {
    current = (current.next as { block?: State } | undefined)?.block ?? null
  }

  return current
}

/**
 * Single undoable event that swaps the full workspace snapshot for composite operations.
 */
class WorkspaceSnapshotEvent extends Blockly.Events.Abstract {
  type = 'workspace_snapshot_replace'
  isBlank = false
  isUiEvent = false

  private readonly beforeState: WorkspaceSnapshot
  private readonly afterState: WorkspaceSnapshot

  constructor(
    workspace: Blockly.WorkspaceSvg,
    beforeState: WorkspaceSnapshot,
    afterState: WorkspaceSnapshot,
  ) {
    super()
    this.workspaceId = workspace.id
    this.beforeState = beforeState
    this.afterState = afterState
    this.recordUndo = true
  }

  override toJson() {
    return {
      ...super.toJson(),
      beforeState: this.beforeState,
      afterState: this.afterState,
    }
  }

  override run(forward: boolean) {
    const workspace = this.getEventWorkspace_()
    const nextState = forward ? this.afterState : this.beforeState

    Blockly.serialization.workspaces.load(
      cloneWorkspaceSnapshot(nextState),
      workspace,
      { recordUndo: false },
    )
  }
}

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

  const parsedCode = parseJson<unknown>(macro.code)
  if (!parsedCode) {
    return
  }

  let blockState: State | null = null

  if (Array.isArray(parsedCode) || hasMacroStepsArray(parsedCode)) {
    const abstractSteps = Array.isArray(parsedCode)
      ? parsedCode
      : parsedCode.steps
    blockState = abstractToBlockly(
      abstractSteps,
      dataObjects,
      dataLocations,
      dataActions,
    ) as State | null
  } else if (isBlockStateLike(parsedCode)) {
    blockState = parsedCode
  }

  if (!isBlockStateLike(blockState)) {
    return
  }

  const prevConnection = block.previousConnection?.targetConnection ?? null
  const nextConnection = block.nextConnection?.targetConnection ?? null
  const xyCoordinates = block.getRelativeToSurfaceXY()
  const beforeSnapshot = saveWorkspaceSnapshot(workspace)

  const existingEventGroup = Blockly.Events.getGroup()
  const shouldManageEventGroup = !existingEventGroup

  if (shouldManageEventGroup) {
    Blockly.Events.setGroup(true)
  }

  try {
    Blockly.Events.disable()

    try {
      if (block.nextConnection && block.nextConnection.targetConnection) {
        block.nextConnection.disconnect()
      }

      block.dispose(false)

      const cleanedState = stripStartBlock(blockState)
      if (!cleanedState) return

      const newFirstBlock = Blockly.serialization.blocks.append(
        cleanedState,
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
      Blockly.Events.enable()
    }

    const afterSnapshot = saveWorkspaceSnapshot(workspace)
    Blockly.Events.fire(
      new WorkspaceSnapshotEvent(workspace, beforeSnapshot, afterSnapshot),
    )
  } catch (error) {
    Blockly.serialization.workspaces.load(
      cloneWorkspaceSnapshot(beforeSnapshot),
      workspace,
      { recordUndo: false },
    )
    console.error('Blockly macro explode undo snapshot error:', error)
  } finally {
    if (shouldManageEventGroup) {
      Blockly.Events.setGroup(false)
    }
  }
}
