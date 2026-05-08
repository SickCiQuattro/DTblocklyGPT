/**
 * mutators.ts
 *
 * Blockly extension mutators for "entity" blocks: objects, locations,
 * robot actions, and macro tasks. Mutators keep the block tooltip and
 * warning text in sync with the serialised `block.data` JSON payload
 * every time the workspace loads, saves, or the block data changes.
 *
 * Registers four mutators (side-effects on import):
 *   - `object_block_mutation`
 *   - `location_block_mutation`
 *   - `action_block_mutation`
 *   - `macro_block_mutation`
 */

import * as Blockly from 'blockly/core'

// ─── INTERNAL HELPERS ────────────────────────────────────────────────────────

/**
 * Safely parse the raw `block.data` string into a typed object.
 * Returns `null` when the payload is absent, not a string, or not valid JSON.
 *
 * @param rawData The value of `block.data` — expected to be a JSON string.
 */
const parseBlockData = (
  rawData: unknown,
): { id?: unknown; keywords?: unknown } | null => {
  if (typeof rawData !== 'string' || rawData.length === 0) return null

  try {
    const parsed = JSON.parse(rawData) as unknown
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as { id?: unknown; keywords?: unknown })
      : null
  } catch {
    return null
  }
}

/**
 * Apply tooltip and warning text to an entity block based on its `data` payload.
 * Called on every mutator lifecycle hook (save, load, render).
 *
 * - Sets the tooltip to the comma-separated keywords stored in `data.keywords`.
 * - Shows `missingWarning` when `data.id` is absent (entity not yet selected).
 *
 * @param block          The Blockly block instance to update.
 * @param missingWarning Warning text shown when the entity has not been selected.
 */
const applyEntityMetadata = (
  block: Blockly.Block,
  missingWarning: string,
): void => {
  const data = parseBlockData(block.data)

  const keywords =
    typeof data?.keywords === 'string'
      ? data.keywords
          .split(',')
          .map((keyword) => keyword.trim())
          .filter((keyword) => keyword.length > 0)
          .join(', ')
      : ''

  const tooltipText = keywords.length > 0 ? `Keywords: ${keywords}` : ''

  block.setTooltip(tooltipText)
  block.setWarningText(data?.id ? null : missingWarning)
}

/**
 * Register a named Blockly mutator that calls `applyEntityMetadata` on every
 * lifecycle event: `mutationToDom`, `domToMutation`, and `loadExtraState`.
 *
 * @param id             The unique mutator identifier string.
 * @param missingWarning Warning shown when `data.id` is missing.
 */
const registerEntityMutator = (
  id: string,
  missingWarning: string,
): void => {
  Blockly.Extensions.registerMutator(id, {
    mutationToDom(this: Blockly.Block) {
      applyEntityMetadata(this, missingWarning)
      return Blockly.utils.xml.createElement('mutation')
    },
    domToMutation(this: Blockly.Block) {
      applyEntityMetadata(this, missingWarning)
    },
    saveExtraState() {
      return null
    },
    loadExtraState(this: Blockly.Block) {
      applyEntityMetadata(this, missingWarning)
    },
  })
}

// ─── MUTATOR REGISTRATIONS ───────────────────────────────────────────────────
// These calls run as side-effects the first time this module is imported,
// making the mutators available globally for use in block JSON definitions.

registerEntityMutator('object_block_mutation', 'Object not defined')
registerEntityMutator('location_block_mutation', 'Destination not defined')
registerEntityMutator('action_block_mutation', 'Procedure not defined')
registerEntityMutator('macro_block_mutation', 'Task not defined')
