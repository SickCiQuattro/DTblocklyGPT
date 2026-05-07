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
 * (those are siblings in the chain, not children of the root).
 */
export const getOwnBodyDescendants = (
  block: Blockly.BlockSvg,
): Blockly.BlockSvg[] => {
  const result: Blockly.BlockSvg[] = []
  const queue: Blockly.Block[] = []

  for (const input of block.inputList) {
    const child = input.connection?.targetBlock()
    if (child) queue.push(child)
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
