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
 * (the connected object/location). Auto-centers the block unless the user is
 * mid-gesture. No-ops safely if the block is gone (e.g. simulated workspace !=
 * displayed workspace) or the workspace isn't ready.
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

  // currentGesture_ is private (trailing _) — same convention as the redoStack_
  // pattern elsewhere. The `?? false` guard keeps this safe if it's absent.
  const dragging = (ws as any).currentGesture_?.isDragging?.() ?? false
  if (!dragging) {
    try {
      ws.centerOnBlock(blockId)
    } catch {
      // workspace not ready / block off-tree — ignore
    }
  }
}

/** Remove every execution highlight from the workspace. */
export function clearExecutingHighlights(ws: Blockly.WorkspaceSvg): void {
  for (const block of ws.getAllBlocks(false)) {
    block
      .getSvgRoot?.()
      ?.classList.remove(EXECUTING_CLASS, EXECUTING_ENTITY_CLASS)
  }
}
