import * as Blockly from 'blockly/core'

/** True if the block has a statement body input (a loop/conditional). */
const hasStatementBody = (block: Blockly.Block): boolean =>
  block.inputList.some(
    (input) => input.connection?.type === Blockly.ConnectionType.NEXT_STATEMENT,
  )

/**
 * Collapse/expand all blocks in one undo step. When collapsing, only blocks
 * with a statement body (Repeat/When/…) are collapsed so the main chain stays
 * visible; expanding clears collapse on everything.
 */
export const setBodiesCollapsed = (
  workspace: Blockly.WorkspaceSvg,
  collapsed: boolean,
): void => {
  Blockly.Events.setGroup(true)
  try {
    for (const block of workspace.getAllBlocks(false)) {
      if (block.isInsertionMarker() || block.isShadow()) continue
      if (collapsed && !hasStatementBody(block)) continue
      if (block.isCollapsed() !== collapsed) block.setCollapsed(collapsed)
    }
  } finally {
    Blockly.Events.setGroup(false)
  }
}

/**
 * Whether each direction would change anything right now, so the menu can grey
 * out the one that would not. Without this a task built from plain steps —
 * every task with no Repeat/When in it — offers a "Compact all" that silently
 * does nothing, which reads as a broken control rather than an unavailable one.
 * Mirrors setBodiesCollapsed exactly: collapsing needs a statement body,
 * expanding needs only something already collapsed.
 */
export const getCollapseState = (
  workspace: Blockly.WorkspaceSvg,
): { canCollapse: boolean; canExpand: boolean } => {
  let canCollapse = false
  let canExpand = false
  for (const block of workspace.getAllBlocks(false)) {
    if (block.isInsertionMarker() || block.isShadow()) continue
    if (block.isCollapsed()) canExpand = true
    else if (hasStatementBody(block)) canCollapse = true
    if (canCollapse && canExpand) break
  }
  return { canCollapse, canExpand }
}
