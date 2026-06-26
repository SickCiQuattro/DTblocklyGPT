import * as Blockly from 'blockly/core'

/**
 * Clean collapsed-block summaries.
 *
 * Blockly fills the collapsed label with `block.toString(30)`, which joins every
 * field's text — including the leading icon's alt (e.g. "TASK:") — and truncates
 * at 30 chars with an ellipsis. On our control-flow blocks that produced the
 * icon-over-"TASK:" overlap and meaningless, clipped names. We override
 * `toString` per block to a concise, human label that fits without truncation.
 */
const SUMMARY: Record<string, (block: Blockly.Block) => string> = {
  repeat_block: (block) => {
    const times = block.getFieldValue('times')
    return times ? `Repeat ${times} times` : 'Repeat'
  },
  repeat_until_block: () => 'Repeat until…',
  when_block: () => 'When…',
  when_otherwise_block: () => 'When… / Otherwise',
}

const EXTENSION_NAME = 'collapsed_summary'

if (!Blockly.Extensions.isRegistered(EXTENSION_NAME)) {
  Blockly.Extensions.register(EXTENSION_NAME, function (this: Blockly.Block) {
    const summarize = SUMMARY[this.type]
    if (summarize) this.toString = () => summarize(this)
  })
}
