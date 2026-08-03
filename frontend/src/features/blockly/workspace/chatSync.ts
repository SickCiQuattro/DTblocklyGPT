/**
 * chatSync.ts
 *
 * Utility for programmatically updating the Blockly workspace from an external
 * state source (e.g. the chat assistant) and firing a synthetic change event so
 * all downstream listeners (orphan sync, history sync, structure diff) react as
 * if the user had made the change interactively.
 *
 * Exported: `updateStructureAndFireFakeChangeEvent`
 */
import * as Blockly from 'blockly/core'

import { BlockState } from 'utils/blocklyTypes'
import { injectAllGhostBlocks } from 'utils/ghostBlockManager'

const DEFAULT_X_AXIS = 200
const DEFAULT_Y_AXIS = 100

/**
 * Recursively strips `id` fields from a serialized block state tree.
 * Prevents ID conflicts when appending blocks to a workspace that
 * just disposed blocks with the same IDs.
 */
const stripBlockIds = (blockState: any): any => {
  if (!blockState || typeof blockState !== 'object') return blockState
  const { id, ...rest } = blockState
  if (rest.inputs) {
    const cleanInputs: any = {}
    for (const [key, val] of Object.entries(rest.inputs)) {
      const input = val as any
      cleanInputs[key] = {
        ...input,
        ...(input.block ? { block: stripBlockIds(input.block) } : {}),
        ...(input.shadow ? { shadow: stripBlockIds(input.shadow) } : {}),
      }
    }
    rest.inputs = cleanInputs
  }
  if (rest.next?.block) {
    rest.next = { ...rest.next, block: stripBlockIds(rest.next.block) }
  }
  return rest
}

/**
 * Replace workspace content from an external source (for example chat-generated task updates)
 * and ensure the operation is tracked as a single undoable action in the Blockly undo stack.
 */
export const updateStructureAndFireFakeChangeEvent = (
  workspace: Blockly.WorkspaceSvg,
  dataTask: BlockState | BlockState[],
  x_axis: number = DEFAULT_X_AXIS,
  y_axis: number = DEFAULT_Y_AXIS,
) => {
  // Use a unique group ID for this transaction so Blockly undo knows it is one atomic operation
  const groupId = 'chat_apply_' + Date.now()
  Blockly.Events.setGroup(groupId)

  try {
    const startBlock = workspace.getBlocksByType(
      'when_start',
      false,
    )[0] as Blockly.BlockSvg | null

    if (startBlock) {
      // 1. Disconnect and dispose any existing child blocks under the start block
      const child = startBlock.nextConnection?.targetBlock()
      if (child) {
        startBlock.nextConnection?.disconnect()
        // dispose(healStack): "If true, heal the gap. Otherwise, dispose of
        // all children of this block." We just disconnected child ourselves
        // — there is no gap left to heal into — so healStack=true's only
        // effect here is to SKIP disposing child's own value-input children
        // (e.g. a processing_block's selected Skill in its ACTION slot).
        // Those children survived as orphaned top-level blocks instead of
        // being torn down with their parent — this is the exact bug behind
        // "task saved, reopened, down to one floating block".
        child.dispose(false)
      }

      // 2. Dispose all other top-level blocks except the start block
      const topBlocks = workspace.getTopBlocks(false)
      topBlocks.forEach((block) => {
        if (block !== startBlock) {
          block.dispose(false)
        }
      })

      // 3. Extract the actual task steps to append under when_start
      let innerBlockState: any = null
      if (Array.isArray(dataTask)) {
        const startBlockInArray = dataTask.find((b) => b.type === 'when_start')
        if (startBlockInArray) {
          innerBlockState = startBlockInArray.next?.block
        } else if (dataTask.length > 0) {
          innerBlockState = dataTask[0]
        }
      } else {
        if (dataTask.type === 'when_start') {
          innerBlockState = (dataTask as any).next?.block
        } else {
          innerBlockState = dataTask
        }
      }

      // 4. Append and connect the new steps
      if (innerBlockState && typeof innerBlockState.type === 'string') {
        let newBlock: Blockly.BlockSvg | null = null
        try {
          newBlock = Blockly.serialization.blocks.append(
            stripBlockIds(innerBlockState),
            workspace,
            {
              recordUndo: true,
            },
          ) as Blockly.BlockSvg
        } catch (err) {
          console.error(
            'Blockly.serialization.blocks.append threw while applying chat proposal',
            err,
            innerBlockState,
          )
        }

        if (
          newBlock &&
          startBlock.nextConnection &&
          newBlock.previousConnection
        ) {
          startBlock.nextConnection.connect(newBlock.previousConnection)
        } else {
          console.error(
            'Chat proposal block was appended but could not be connected under when_start',
            {
              newBlock,
              hasStartConn: !!startBlock.nextConnection,
              innerBlockState,
            },
          )
        }
      } else {
        console.error(
          'Chat proposal had no usable block to insert under when_start',
          innerBlockState,
        )
      }
    } else {
      // Fallback: if no when_start block exists, dispose all and append the wrapped state
      const topBlocks = workspace.getTopBlocks(false)
      topBlocks.forEach((block) => {
        block.dispose(false)
      })

      if (Array.isArray(dataTask)) {
        dataTask.forEach((block) => {
          const defaultDataTask = { ...block }
          defaultDataTask.x = block.x ?? x_axis
          defaultDataTask.y = block.y ?? y_axis
          Blockly.serialization.blocks.append(
            stripBlockIds(defaultDataTask),
            workspace,
            {
              recordUndo: true,
            },
          )
        })
      } else {
        let defaultDataTask = { ...dataTask }
        if (defaultDataTask.type !== 'when_start') {
          defaultDataTask = {
            type: 'when_start',
            x: x_axis,
            y: y_axis,
            next: {
              block: defaultDataTask,
            },
          }
        } else {
          defaultDataTask.x = x_axis
          defaultDataTask.y = y_axis
        }
        Blockly.serialization.blocks.append(
          stripBlockIds(defaultDataTask),
          workspace,
          {
            recordUndo: true,
          },
        )
      }
    }

    injectAllGhostBlocks(workspace)

    // New blocks land at whatever x/y the previous first block happened to
    // have. If the user had scrolled or zoomed away from that spot, the
    // applied proposal is technically in the workspace but off-screen —
    // looks exactly like "nothing happened" with zero console error.
    workspace.scrollCenter()
  } finally {
    Blockly.Events.setGroup(false)
  }
}
