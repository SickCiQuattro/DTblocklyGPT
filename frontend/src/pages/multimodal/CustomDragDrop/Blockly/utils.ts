import * as Blockly from 'blockly/core'
import { State } from 'blockly/core/serialization/blocks'

export const updateStructureAndFireFakeChangeEvent = (
  workspace: Blockly.WorkspaceSvg,
  defaultDataTask: State,
) => {
  const tempBlock = Blockly.serialization.blocks.append(
    defaultDataTask,
    workspace,
  )

  const xml = Blockly.Xml.blockToDom(tempBlock) as Element

  Blockly.Events.setGroup('chat_response_import')
  Blockly.Xml.domToWorkspace(xml, workspace)
  Blockly.Events.setGroup(false)
}
