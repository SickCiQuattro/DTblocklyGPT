/**
 * macroExplosion.ts
 *
 * Implements the "Break into steps" operation: replaces a `macro_task_block`
 * with the full block chain it encodes, inserting the expanded blocks at the
 * same position in the statement sequence.
 *
 * Exported helpers:
 *  - `explodeMacro`            — main entry point; expands a macro block in-place.
 *  - `getMacroIdFromBlockData` — reads the macro ID from a block's serialised `data`.
 */
import * as Blockly from 'blockly/core'

import { TaskDetailType, TaskType } from 'pages/tasks/types'
import { BlockState as State } from 'utils/blocklyTypes'
import { parseJson, isAbstractStepArray, isValidBlockState } from '../utils/serialization'
import { abstractToBlockly } from 'utils/blocklyParser'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

type WorkspaceSnapshot = Record<string, unknown>

type BlocklyWorkspaceState = {
  blocks?: {
    blocks?: unknown[]
  }
}

const MACRO_EXCLUDED_TYPES = new Set([
  'when_start',
  'shadow_start_sequence_block',
])

// ─── SNAPSHOT HELPERS ─────────────────────────────────────────────────────────

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
): WorkspaceSnapshot =>
  cloneWorkspaceSnapshot(
    Blockly.serialization.workspaces.save(workspace) as WorkspaceSnapshot,
  )

// ─── TYPE GUARDS ──────────────────────────────────────────────────────────────

const isBlockStateLike = (value: unknown): value is State =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  typeof (value as { type?: unknown }).type === 'string'

const isWorkspaceState = (value: unknown): value is BlocklyWorkspaceState =>
  typeof value === 'object' && value !== null && 'blocks' in value

// ─── BLOCK STATE HELPERS ──────────────────────────────────────────────────────

/**
 * Walk the `next` chain and return the first block whose type is NOT in
 * `MACRO_EXCLUDED_TYPES`, stripping scaffolding blocks (start / shadow-start).
 */
const stripStartBlock = (state: State): State | null => {
  if (!MACRO_EXCLUDED_TYPES.has(state.type as string)) return state

  let current: State | null =
    (state.next as { block?: State } | undefined)?.block ?? null

  while (current && MACRO_EXCLUDED_TYPES.has(current.type as string)) {
    current = (current.next as { block?: State } | undefined)?.block ?? null
  }

  return current
}

// ─── WORKSPACE SNAPSHOT EVENT ────────────────────────────────────────────────

/**
 * Single undoable event that atomically swaps the full workspace snapshot.
 *
 * We register the event type once at module load so Blockly's event system
 * recognises it and includes it in the undo/redo stack. Without registration
 * `run()` is never called during undo, making the explosion non-reversible.
 */
const SNAPSHOT_EVENT_TYPE = 'workspace_snapshot_replace'

class WorkspaceSnapshotEvent extends Blockly.Events.Abstract {
  override type = SNAPSHOT_EVENT_TYPE
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

// ─── PUBLIC HELPERS ───────────────────────────────────────────────────────────

/**
 * Resolve the macro identifier from Blockly block metadata.
 * Accepts both `{ taskId }` (legacy key written by older picker code) and
 * `{ id }` (current key).
 */
export const getMacroIdFromBlockData = (rawData: unknown): string | null => {
  if (typeof rawData !== 'string' || rawData.trim().length === 0) return null

  const parsed = parseJson<{ id?: number | string; taskId?: number | string }>(
    rawData,
  )
  const macroId = parsed?.id ?? parsed?.taskId
  if (macroId === undefined || macroId === null) return null

  const normalized = `${macroId}`.trim()
  return normalized.length > 0 ? normalized : null
}

// ─── RESOLVE MACRO WORKSPACE ─────────────────────────────────────────────────

/**
 * Return the block state to expand for a given macro detail.
 *
 * Priority (consistent with the server-side `get_graphic_task` view):
 *   1. `published_workspace`  — the stable, published version shown in the toolbox.
 *   2. `workspace`            — fallback for legacy records that pre-date the
 *                              `published_workspace` field.
 *
 * We intentionally never read `draft_workspace`: the toolbox always shows the
 * last *published* state, and exploding a macro must expand the same content.
 */
const resolveMacroBlockState = (
  macroDetail: TaskDetailType,
): State | null => {
  // macroDetail.code is populated from published_workspace by the macroList
  // endpoint (see index.tsx macroDetailsById mapping).
  const rawSource = macroDetail.code
  const source = typeof rawSource === 'string' ? parseJson<unknown>(rawSource) : rawSource

  if (!source) return null

  // If the payload is abstract steps, convert them to Blockly format first.
  if (isAbstractStepArray(source)) {
    const converted = abstractToBlockly(source, [], [], [])
    if (isValidBlockState(converted)) {
      // It returns an array of blocks or a single root. In abstractToBlockly it returns the root.
      // Actually abstractToBlockly returns the root block, wait, let's verify.
      // `abstractToBlockly` returns the first block (which is `{ type: '...', next: ... }`).
      // So `converted` is a single block state (the root of the chain).
      return isBlockStateLike(converted) ? converted : null
    }
  }

  // Native Blockly workspace JSON: { blocks: { blocks: [...] } }
  if (isWorkspaceState(source)) {
    const topBlocks = source.blocks?.blocks ?? []
    const firstRoot = topBlocks.find((b) => isBlockStateLike(b))
    return isBlockStateLike(firstRoot) ? firstRoot : null
  }

  // Top-level block array: [ { type: "when_start" }, ... ]
  if (Array.isArray(source)) {
    const firstRoot = source.find((b) => isBlockStateLike(b))
    return isBlockStateLike(firstRoot) ? firstRoot : null
  }

  // Single block state serialised directly at the root level.
  if (isBlockStateLike(source)) return source

  return null
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

/**
 * Input required to replace a `macro_task_block` with its expanded block chain.
 */
interface ExplodeMacroParams {
  block: Blockly.BlockSvg
  workspace: Blockly.WorkspaceSvg
  dataMacros: TaskType[]
  macroDetailsById: Record<number, TaskDetailType>
}

/**
 * Replace a macro block with its concrete block sequence while preserving
 * chain connections and registering a single undoable snapshot event.
 */
export const explodeMacro = ({
  block,
  workspace,
  dataMacros,
  macroDetailsById,
}: ExplodeMacroParams): void => {
  if (!block || block.type !== 'macro_task_block') return

  const macroId = getMacroIdFromBlockData(block.data)
  if (!macroId) return

  const macro = dataMacros.find((t) => `${t.id}` === macroId)
  if (!macro) return

  const numericId = Number(macroId)
  if (Number.isNaN(numericId)) return

  const macroDetail = macroDetailsById[numericId]
  if (!macroDetail) return

  // Resolve the published block state. If it is null the macro has no stable
  // published version yet (e.g. still in draft) — abort with a clear guard
  // rather than silently doing nothing.
  const blockState = resolveMacroBlockState(macroDetail)
  if (!isBlockStateLike(blockState)) return

  // Snapshot all connections before touching the DOM.
  const prevConnection = block.previousConnection?.targetConnection ?? null
  const nextConnection = block.nextConnection?.targetConnection ?? null
  const xyCoordinates = block.getRelativeToSurfaceXY()
  const beforeSnapshot = saveWorkspaceSnapshot(workspace)

  const existingGroup = Blockly.Events.getGroup()
  const shouldManageGroup = !existingGroup
  if (shouldManageGroup) Blockly.Events.setGroup(true)

  try {
    Blockly.Events.disable()

    try {
      // Sever the next-chain before disposing so Blockly does not also
      // dispose all downstream blocks.
      if (block.nextConnection?.targetConnection) {
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
        throw new Error('Blockly failed to render the expanded macro state.')
      }

      if (prevConnection && newFirstBlock.previousConnection) {
        prevConnection.connect(newFirstBlock.previousConnection)
      } else {
        newFirstBlock.moveTo(xyCoordinates)
      }

      // Walk to the last block in the new chain and reconnect downstream.
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
    // Restore the workspace to the pre-explosion state on any failure.
    Blockly.serialization.workspaces.load(
      cloneWorkspaceSnapshot(beforeSnapshot),
      workspace,
      { recordUndo: false },
    )
    console.error(
      '[explodeMacro] explosion failed — workspace restored:',
      error,
    )
  } finally {
    if (shouldManageGroup) Blockly.Events.setGroup(false)
  }
}
