import * as Blockly from 'blockly/core'

import { type BlockViewMode } from './useViewSettings'

const SHADOW_PLACEHOLDER_TYPES = new Set<string>([
  'shadow_object_block',
  'shadow_location_block',
  'shadow_action_block',
  'shadow_trigger_block',
  'shadow_sequence_block',
  'shadow_start_sequence_block',
])

export const applyBlockViewMode = (
  workspace: Blockly.WorkspaceSvg,
  blockViewMode: BlockViewMode,
): void => {
  const showBlockIcons = blockViewMode === 'complete'
  const showShadowLabel = blockViewMode !== 'minimal'

  Blockly.Events.disable()
  try {
    for (const block of workspace.getAllBlocks(false)) {
      if (block.isInsertionMarker()) continue

      let changed = false
      for (const input of block.inputList) {
        for (const field of input.fieldRow) {
          if (field instanceof Blockly.FieldImage) {
            const isShadowPlaceholder = SHADOW_PLACEHOLDER_TYPES.has(block.type)
            const visible = isShadowPlaceholder ? true : showBlockIcons
            if (field.isVisible() !== visible) {
              field.setVisible(visible)
              changed = true
            }
            continue
          }

          const isShadowNameField =
            field.name === 'name' && SHADOW_PLACEHOLDER_TYPES.has(block.type)
          if (!isShadowNameField) continue

          if (field.isVisible() !== showShadowLabel) {
            field.setVisible(showShadowLabel)
            changed = true
          }
        }
      }

      if (changed && block instanceof Blockly.BlockSvg && !block.disposed) {
        block.render()
      }
    }
  } finally {
    Blockly.Events.enable()
  }
}
