/**
 * conformance.ts
 *
 * Pure, framework-agnostic utility that computes whether the current Blockly
 * workspace represents a task that is ready to execute ("ready") or still
 * incomplete ("draft").
 *
 * Design constraints:
 *  - Zero React / DOM dependencies — safe to unit-test in isolation.
 *  - Zero side-effects — never mutates the workspace.
 *  - Understands the project's shadow block conventions (types defined in
 *    definitions.ts) so it can detect unresolved placeholder slots.
 *
 */

import * as Blockly from 'blockly/core'

// ─── Shadow block types ───────────────────────────────────────────────────────
// All six placeholder types defined in definitions.ts.
// A task is Draft if any of these remain connected anywhere in the main flow.

const SHADOW_BLOCK_TYPES = new Set([
  'shadow_object_block',
  'shadow_location_block',
  'shadow_action_block',
  'shadow_trigger_block',
  'shadow_sequence_block',
  'shadow_start_sequence_block',
])

// The mandatory entry-point block (when present it is the single root).
const START_BLOCK_TYPE = 'when_start'

// ─── Public types ─────────────────────────────────────────────────────────────

export type TaskStatus = 'draft' | 'ready'

export type ConformanceIssue =
  | { type: 'EMPTY_WORKSPACE' }
  | { type: 'MULTIPLE_FLOWS'; count: number }
  | {
      type: 'UNRESOLVED_SHADOW'
      blockId: string
      blockType: string
      humanLabel: string
    }

export interface ConformanceResult {
  status: TaskStatus
  issues: ConformanceIssue[]
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Returns true when the block is one of the project's unresolved shadow
 * placeholder types. Checks the explicit type set because ghost blocks in this
 * project use setShadow(true) only for styling — isShadow() alone is not a
 * reliable signal for "slot not filled yet".
 */
const isUnresolvedShadow = (block: Blockly.Block): boolean =>
  SHADOW_BLOCK_TYPES.has(block.type)

const toShadowIssue = (block: Blockly.Block): ConformanceIssue => {
  const nameField = block.getField('name')
  const humanLabel = nameField
    ? String(nameField.getValue())
    : block.type.replace(/_/g, ' ')

  return {
    type: 'UNRESOLVED_SHADOW',
    blockId: block.id,
    blockType: block.type,
    humanLabel,
  }
}

/**
 * Recursively walks every block reachable from `root` via:
 *  - value inputs (e.g. OBJECT slot in pick_block)
 *  - statement inputs (e.g. DO body in repeat_block)
 *  - next-statement chain
 *
 * Collects every unresolved shadow block found, with a human-readable label
 * derived from the block's `name` field (set in createShadowEntityBlock) or
 * falling back to the type string.
 */
const collectUnresolvedShadows = (
  block: Blockly.Block,
  found: ConformanceIssue[] = [],
): ConformanceIssue[] => {
  for (const input of block.inputList) {
    const connected = input.connection?.targetBlock()
    if (!connected) continue

    if (isUnresolvedShadow(connected)) {
      found.push(toShadowIssue(connected))
    } else {
      // Recurse into real connected blocks (handles nested repeat, when, etc.)
      collectUnresolvedShadows(connected, found)
    }
  }

  // Walk the next-statement chain.
  const next = block.getNextBlock()
  if (next) collectUnresolvedShadows(next, found)

  return found
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Computes the conformance state of the given workspace.
 *
 * Rules (evaluated in order — first failure wins):
 *  1. Workspace has no enabled non-shadow top-level blocks → DRAFT / EMPTY_WORKSPACE
 *  2. More than one top-level flow exists               → DRAFT / MULTIPLE_FLOWS
 *  3. Any unresolved shadow block in the flow           → DRAFT / UNRESOLVED_SHADOW
 *  4. All rules pass                                    → READY
 *
 * Works identically regardless of whether the when_start block is present
 * (Detailed/Essential mode) or absent (Minimal mode). The start block is
 * treated as an ordinary root when present — traversal begins from its first
 * connected child to avoid false positives on the start block itself.
 */
export const computeConformance = (
  workspace: Blockly.Workspace,
): ConformanceResult => {
  // Collect all roots: enabled, non-shadow top-level blocks.
  const topBlocks = workspace
    .getTopBlocks(false)
    .filter((b) => b.isEnabled() && !isUnresolvedShadow(b))

  // ── Rule 1: empty workspace ──────────────────────────────────────────────
  if (topBlocks.length === 0) {
    return { status: 'draft', issues: [{ type: 'EMPTY_WORKSPACE' }] }
  }

  // ── Rule 2: multiple flows ───────────────────────────────────────────────
  if (topBlocks.length > 1) {
    return {
      status: 'draft',
      issues: [{ type: 'MULTIPLE_FLOWS', count: topBlocks.length }],
    }
  }

  // ── Rule 3: unresolved shadow blocks ────────────────────────────────────
  const root = topBlocks[0]

  // When the root is when_start, begin traversal from its first child so the
  // start block itself is never misidentified as an unresolved slot.
  const traversalRoot =
    root.type === START_BLOCK_TYPE ? (root.getNextBlock() ?? root) : root

  if (isUnresolvedShadow(traversalRoot)) {
    return { status: 'draft', issues: [toShadowIssue(traversalRoot)] }
  }

  const shadowIssues = collectUnresolvedShadows(traversalRoot)
  if (shadowIssues.length > 0) {
    return { status: 'draft', issues: shadowIssues }
  }

  // ── All rules pass ───────────────────────────────────────────────────────
  return { status: 'ready', issues: [] }
}

/**
 * Maps a ConformanceIssue to a human-readable, actionable string.
 * Suitable for tooltip content, aria-labels, and status messages.
 */
export const formatIssue = (issue: ConformanceIssue): string => {
  switch (issue.type) {
    case 'EMPTY_WORKSPACE':
      return 'The workspace is empty — add at least one block to start.'
    case 'MULTIPLE_FLOWS':
      return `${issue.count} separate flows detected — connect all blocks into one sequence.`
    case 'UNRESOLVED_SHADOW':
      return `"${issue.humanLabel}" requires a selection.`
  }
}
