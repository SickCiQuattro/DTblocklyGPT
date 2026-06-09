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
 * Issue severity model:
 *  - 'error'   → blocks Save (task) / Publish (macro). Workspace is not ready.
 *  - 'warning' → non-blocking. Workspace is still ready (e.g. floating blocks).
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
export type ConformanceIssueSeverity = 'error' | 'warning'

export type ConformanceIssue =
  | { type: 'EMPTY_WORKSPACE'; severity: 'error' }
  | { type: 'MULTIPLE_FLOWS'; severity: 'error'; count: number }
  | {
      type: 'UNRESOLVED_SHADOW'
      severity: 'error'
      blockId: string
      blockType: string
      humanLabel: string
    }
  | {
      type: 'FLOATING_BLOCK'
      severity: 'warning'
      blockId: string
      blockType: string
    }

export interface ConformanceResult {
  /** 'draft' if any errors exist, 'ready' otherwise (warnings are allowed). */
  status: TaskStatus
  /** All issues, errors first then warnings. */
  issues: ConformanceIssue[]
  /** Only severity === 'error' — block Save / Publish. */
  errors: ConformanceIssue[]
  /** Only severity === 'warning' — non-blocking, shown as advisory. */
  warnings: ConformanceIssue[]
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
    severity: 'error',
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

/** Builds the final ConformanceResult from a list of errors and warnings. */
const buildResult = (
  errors: ConformanceIssue[],
  warnings: ConformanceIssue[],
): ConformanceResult => ({
  status: errors.length > 0 ? 'draft' : 'ready',
  issues: [...errors, ...warnings],
  errors,
  warnings,
})

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Computes the conformance state of the given workspace.
 *
 * Rules (in order):
 *  1. No enabled non-shadow top-level blocks  → error EMPTY_WORKSPACE
 *  2. More than one top-level connected flow  → error MULTIPLE_FLOWS
 *     Note: extra disconnected tops become FLOATING_BLOCK warnings instead.
 *  3. Any unresolved shadow block in the flow → error UNRESOLVED_SHADOW (×N)
 *  4. Orphan/floating blocks outside the flow → warning FLOATING_BLOCK (×N)
 *
 * Status is 'ready' only when there are zero errors (warnings are allowed).
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
    return buildResult([{ type: 'EMPTY_WORKSPACE', severity: 'error' }], [])
  }

  // ── Identify the main flow root ──────────────────────────────────────────
  // Prefer the when_start block as root; otherwise take the first top block.
  const startBlock = topBlocks.find((b) => b.type === START_BLOCK_TYPE)
  const root = startBlock ?? topBlocks[0]

  // ── Rule 2: multiple flows (error) ───────────────────────────────────────
  // If there are multiple disconnected top-level blocks, the workspace is
  // ambiguous. We enforce a single flow to consider the task 'ready'.
  if (topBlocks.length > 1) {
    return buildResult(
      [{ type: 'MULTIPLE_FLOWS', severity: 'error', count: topBlocks.length }],
      [],
    )
  }

  // ── Rule 3: unresolved shadow blocks in the main flow ────────────────────
  // When the root is when_start, begin traversal from its first child so the
  // start block itself is never misidentified as an unresolved slot.
  const traversalRoot =
    root.type === START_BLOCK_TYPE ? (root.getNextBlock() ?? root) : root

  if (isUnresolvedShadow(traversalRoot)) {
    return buildResult([toShadowIssue(traversalRoot)], [])
  }

  const shadowErrors = collectUnresolvedShadows(traversalRoot)
  if (shadowErrors.length > 0) {
    return buildResult(shadowErrors, [])
  }

  // ── All errors resolved ───────────────────────────────────────────────────
  return buildResult([], [])
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
    case 'FLOATING_BLOCK':
      return 'A disconnected block was found — it will be ignored at runtime.'
  }
}
