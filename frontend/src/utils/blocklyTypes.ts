import type * as Blockly from 'blockly/core'
import type { serialization } from 'blockly/core'

/**
 * Serialized state for a single Blockly block as returned by Blockly serialization APIs.
 *
 * This type is reused across editor, preview, and backend payload transforms.
 */
export type BlockState = NonNullable<
  ReturnType<typeof Blockly.serialization.blocks.save>
>

/**
 * Represents the state of a connection, including optional shadow or block.
 * Directly re-exported from Blockly's serialization API.
 */
export type ConnectionState = serialization.blocks.ConnectionState
