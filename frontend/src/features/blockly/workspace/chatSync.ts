import * as Blockly from 'blockly/core'

import { BlockState } from 'utils/blocklyTypes'

/**
 * Replace workspace content from an external source (for example chat-generated task updates)
 * and ensure the operation is tracked as a single undoable action.
 */
export const updateStructureAndFireFakeChangeEvent = (
  workspace: Blockly.WorkspaceSvg,
  blockState: BlockState,
) => {
  Blockly.Events.setGroup('update_task_import')

  workspace.clear()
  Blockly.serialization.blocks.appendInternal(blockState, workspace, {
    recordUndo: true,
  })
  Blockly.Events.setGroup(false)
}
