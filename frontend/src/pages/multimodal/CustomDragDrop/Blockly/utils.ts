import * as Blockly from 'blockly/core'
import { State } from 'blockly/core/serialization/blocks'

export const updateStructureAndFireFakeChangeEvent = (
  workspace: Blockly.WorkspaceSvg,
  defaultDataTask: State,
) => {
  Blockly.Events.setGroup('update_task_import')

  workspace.clear()
  Blockly.serialization.blocks.appendInternal(defaultDataTask, workspace, {
    recordUndo: true,
  })
  Blockly.Events.setGroup(false)
}
