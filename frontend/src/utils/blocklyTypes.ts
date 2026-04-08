import type * as Blockly from 'blockly/core'

export type BlockState = NonNullable<
  ReturnType<typeof Blockly.serialization.blocks.save>
>
