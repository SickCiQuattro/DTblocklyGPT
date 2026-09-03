/**
 * blockHighlight.ts
 *
 * Live execution highlight: marks the Blockly block currently being run by the
 * robot (driven by `block_step` socket events) with a CSS class on its SVG root,
 * plus its connected entity blocks (the object/location value inputs). Reuses the
 * established `getSvgRoot()?.classList` pattern (see orphan/shadow styling) and
 * stays independent of the yellow user-selection outline (separate classes).
 */
import * as Blockly from 'blockly/core'

const EXECUTING_CLASS = 'block--executing'
const EXECUTING_ENTITY_CLASS = 'block--executing-entity'

/**
 * Highlight `blockId` as currently executing, plus its value-input children
 * (the connected object/location). No-ops safely if the block is gone (e.g.
 * simulated workspace != displayed workspace) or the workspace isn't ready.
 */
export function highlightExecutingBlock(
  ws: Blockly.WorkspaceSvg,
  blockId: string,
): void {
  const block = ws.getBlockById(blockId)
  if (!block || !(block instanceof Blockly.BlockSvg)) return

  block.getSvgRoot()?.classList.add(EXECUTING_CLASS)

  // Also light up connected entity blocks (object/location) on value inputs —
  // not statement bodies (the next-step chain).
  for (const input of block.inputList) {
    if (input.connection?.type !== Blockly.ConnectionType.INPUT_VALUE) continue
    const target = input.connection.targetBlock()
    if (target instanceof Blockly.BlockSvg) {
      target.getSvgRoot()?.classList.add(EXECUTING_ENTITY_CLASS)
    }
  }
}

/**
 * Bring the running block into view — but ONLY when it is off-screen.
 *
 * That condition is the whole design. An always-recentring version existed
 * before and was removed because it yanked the canvas on every step, including
 * the ones already in front of the operator, and fought anyone trying to pan.
 * Scrolling only when the block has actually left the viewport makes the
 * canvas hold still exactly when holding still is what the operator wants.
 *
 * No-ops if the block is gone (a macro's inner blocks live in another task's
 * workspace and are never on this canvas).
 */
export function scrollRunningBlockIntoView(
  ws: Blockly.WorkspaceSvg,
  blockId: string,
): void {
  const block = ws.getBlockById(blockId)
  if (!block || !(block instanceof Blockly.BlockSvg)) return

  const view = ws.getMetricsManager().getViewMetrics(true)
  const bounds = block.getBoundingRectangle()
  const fullyVisible =
    bounds.left >= view.left &&
    bounds.right <= view.left + view.width &&
    bounds.top >= view.top &&
    bounds.bottom <= view.top + view.height
  if (fullyVisible) return

  ws.scrollBoundsIntoView(bounds, 40)
}

/** Remove every execution highlight from the workspace. */
export function clearExecutingHighlights(ws: Blockly.WorkspaceSvg): void {
  for (const block of ws.getAllBlocks(false)) {
    block
      .getSvgRoot?.()
      ?.classList.remove(EXECUTING_CLASS, EXECUTING_ENTITY_CLASS)
  }
}
