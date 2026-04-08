import * as Blockly from 'blockly/core'

import { BlockState as State } from 'utils/blocklyTypes'

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
