import * as Blockly from 'blockly/core'

export function filterRealBlocks<T extends Blockly.Block>(
  blocks: T[],
  excludeType?: string,
): T[] {
  return blocks.filter(
    (b) =>
      !b.isShadow() &&
      !b.isInsertionMarker() &&
      (excludeType ? b.type !== excludeType : true),
  )
}

export function countRealBlocks(
  blocks: Blockly.Block[],
  excludeType?: string,
): number {
  return filterRealBlocks(blocks, excludeType).length
}

/**
 * Returns all blocks that logically "belong" to the given root block:
 * blocks connected via inputList (the body), recursively.
 * Does NOT include blocks attached via the root's nextConnection
 * (those are siblings in the chain, not children of the root) — unless
 * `includeFollowing` is set, which is what a drag needs: dragging a block
 * detaches it *with* everything under it, so for that gesture the trailing
 * chain is part of what the operator is holding, not a sibling left behind.
 */
export const getOwnBodyDescendants = (
  block: Blockly.BlockSvg,
  includeFollowing = false,
): Blockly.BlockSvg[] => {
  const result: Blockly.BlockSvg[] = []
  const queue: Blockly.Block[] = []

  for (const input of block.inputList) {
    const child = input.connection?.targetBlock()
    if (child) queue.push(child)
  }
  if (includeFollowing) {
    const following = block.nextConnection?.targetBlock()
    if (following) queue.push(following)
  }

  while (queue.length > 0) {
    const current = queue.pop()!
    if (current instanceof Blockly.BlockSvg) result.push(current)
    for (const input of current.inputList) {
      const child = input.connection?.targetBlock()
      if (child) queue.push(child)
    }
    const next = current.nextConnection?.targetBlock()
    if (next) queue.push(next)
  }

  return filterRealBlocks(result)
}

/**
 * Delete a block and everything in its body, leaves first, as one undo step.
 *
 * Blockly's own deletion (`BlockSvg.checkAndDelete()` → `dispose(healStack)`,
 * which is what its Delete shortcut and its context-menu item both run) cascades
 * from the parent down, and silently leaves a value-input child behind as a
 * floating orphan when the parent occupies a connection that has a default
 * shadow configured — a condition slot, for instance. Reproduced by hand.
 *
 * Disposing the descendants explicitly first, in reverse order, avoids the
 * cascade entirely. Every deletion path in the editor must route through here:
 * this used to run only when a confirmation dialog was shown, which meant the
 * most common case of all — deleting a single block, where the default
 * `deleteConfirmMode: 'multiple'` asks nothing — fell through to Blockly and hit
 * the very bug this exists to avoid.
 *
 * `healStack` is the difference between the two gestures, and getting it wrong
 * is visible to the operator:
 *
 *  - Delete key and context menu remove ONE block from a stack that is still
 *    assembled. Healing is the whole point — the steps below it close the gap
 *    and the program stays connected. This is the default.
 *  - The delete zone receives a block a drag already detached, and a drag
 *    carries everything below along with it. There is no stack left to heal:
 *    healing there re-parents the trailing steps onto nothing, so they survive
 *    the delete and land back on the canvas as a floating stack — the operator
 *    dropped six blocks on the toolbox and five came back. Hence `false`, plus
 *    the trailing chain in the descendant sweep so those blocks are disposed
 *    leaf-first too rather than by the cascade this helper exists to avoid.
 */
export const disposeBlockWithBody = (
  block: Blockly.BlockSvg,
  { animate = false, healStack = true } = {},
): void => {
  const descendants = getOwnBodyDescendants(block, !healStack)
  // Join the caller's event group when there is one, instead of always opening
  // a fresh one. The drag-to-toolbox delete zone groups the disposal with the
  // drag events that preceded it so the whole gesture undoes in one press;
  // unconditionally calling setGroup(true)/setGroup(false) here would split
  // that in two and close the caller's group early.
  const outerGroup = Blockly.Events.getGroup()
  if (!outerGroup) Blockly.Events.setGroup(true)
  try {
    for (let i = descendants.length - 1; i >= 0; i--) {
      if (!descendants[i].disposed) descendants[i].dispose(false)
    }
    if (!block.disposed) block.dispose(healStack, animate)
  } finally {
    if (!outerGroup) Blockly.Events.setGroup(false)
  }
}
