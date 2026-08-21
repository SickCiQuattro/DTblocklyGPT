/**
 * A task's `code` comes back in one of two shapes: a Blockly workspace payload
 * (block states, the shape `blocklyToAbstractAll()` consumes) or an already
 * abstract `AbstractStep[]` (the shape `abstractToBlockly()` consumes). Nothing
 * in the record says which, so every reader has to sniff it, and feeding either
 * one to the wrong converter yields an empty task rather than an error.
 */

/**
 * Blockly block states are the only ones whose `type` is a registered block
 * type: everything in the palette ends in `_block`, and `when_start` — the
 * entry-point marker — is the single registered type that doesn't (see
 * features/blockly/blocks/definitions.ts). Abstract steps carry bare type names
 * ('pick', 'gesture', …), so the suffix test is what separates the two.
 */
const isBlocklyBlock = (item: unknown): boolean => {
  if (typeof item !== 'object' || item === null) return false
  const type = (item as { type?: unknown }).type
  if (typeof type !== 'string') return false
  return type.endsWith('_block') || type.startsWith('when_')
}

/**
 * True when `code` is a Blockly workspace payload — either a single root block
 * state or an array of them. An array counts as Blockly as soon as one entry
 * looks like a block: the two shapes are never mixed, so a single match
 * identifies the payload, and a stray null/typeless entry can't veto it.
 */
export const isBlocklyPayload = (code: unknown): boolean =>
  Array.isArray(code) ? code.some(isBlocklyBlock) : isBlocklyBlock(code)
