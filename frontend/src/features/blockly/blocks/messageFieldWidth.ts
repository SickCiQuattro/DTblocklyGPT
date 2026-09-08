import * as Blockly from 'blockly/core'

import { blockDescriptionsByType } from './blockTextDictionary'

/**
 * Keep an operator's own message from hiding the condition it belongs to.
 *
 * `human_action_block` is two rows: the message the operator writes, and
 * "Resume when:" with the socket that says what ends the pause. `TASK_DESC` is
 * a `field_input`, which renders on a single line and grows with its text, and
 * an external value input puts its socket at the RIGHT EDGE of the block. So a
 * long message widens row one, the block widens with it, and the socket on row
 * two travels off to the right — past the edge of the canvas on a workspace
 * that is already sharing the screen with Copilot and the robot panel.
 *
 * The operator loses sight of the one thing that makes the block a pause
 * rather than a notice. Reported after a pilot run.
 *
 * Blockly has no wrapping text field in core here (FieldMultilineInput moved
 * out to a plugin, which this project does not depend on), so the width is
 * capped instead: `maxDisplayLength` truncates what is DRAWN, with an ellipsis,
 * and leaves the stored value untouched. Nothing is lost — the field still
 * holds and saves the whole message, clicking it opens the full text to edit,
 * and the tooltip below reads it out without entering edit mode.
 */
const MAX_DISPLAYED_CHARS = 30

const EXTENSION_NAME = 'human_message_field'

/** Blocks whose TASK_DESC is free text an operator writes. */
const DESCRIBED_BLOCKS = ['human_action_block', 'notify_action_block'] as const

if (!Blockly.Extensions.isRegistered(EXTENSION_NAME)) {
  Blockly.Extensions.register(EXTENSION_NAME, function (this: Blockly.Block) {
    const field = this.getField('TASK_DESC')
    if (field) field.maxDisplayLength = MAX_DISPLAYED_CHARS

    // A function, so it is evaluated on hover rather than at definition time:
    // the message changes as the operator types, and a string captured here
    // would describe whatever the block held when it was created.
    //
    // The block's own description stays first — it is what a reader who does
    // not know the block needs — and the message is appended only when the
    // canvas is actually showing less than all of it. Repeating a message that
    // is already fully visible would make the tooltip noise on the common case.
    this.setTooltip(() => {
      const description =
        blockDescriptionsByType[
          this.type as keyof typeof blockDescriptionsByType
        ] ?? ''
      const message = String(this.getFieldValue('TASK_DESC') ?? '')
      return message.length > MAX_DISPLAYED_CHARS
        ? `${description}\n\nMessage: ${message}`
        : description
    })
  })
}

export const HUMAN_MESSAGE_FIELD_EXTENSION = EXTENSION_NAME
export const HUMAN_MESSAGE_MAX_DISPLAYED_CHARS = MAX_DISPLAYED_CHARS
export const HUMAN_MESSAGE_BLOCKS = DESCRIBED_BLOCKS
