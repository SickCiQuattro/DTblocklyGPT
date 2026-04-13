import type * as Blockly from 'blockly/core'

/**
 * Serialized state for a single Blockly block as returned by Blockly serialization APIs.
 *
 * This type is reused across editor, preview, and backend payload transforms.
 */
export type BlockState = NonNullable<
  ReturnType<typeof Blockly.serialization.blocks.save>
>
