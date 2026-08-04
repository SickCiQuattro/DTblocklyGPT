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
  | {
      type: 'ORPHAN_MACRO_REF'
      severity: 'warning'
      blockId: string
      macroId: number
      macroName: string
    }
  | {
      type: 'CIRCULAR_MACRO_REF'
      severity: 'warning'
      blockId: string
      macroId: number
      macroName: string
    }

/**
 * A single macro_task_block reference found while walking a workspace (live
 * or serialized) — { id, name } is the exact shape stored in the block's
 * `data` JSON (see blocklyParser.ts's `stepToBlock` 'macro_task' case).
 */
export type MacroRef = { id: number; name: string; blockId?: string }

/**
 * Everything computeConformance needs to check macro references, pre-built
 * by the caller (useConformance.ts) from React-side data
 * (macroDetailsById in task-workspace/index.tsx). Kept as plain
 * data in/data out so this file stays framework-agnostic — see the file's
 * design constraints above.
 */
export type MacroContext = {
  /** id of the task currently open in the editor, or null if unsaved/new —
   *  used as the start of the cycle search: does anything this task
   *  references eventually reference back to this task itself. */
  currentTaskId: number | null
  /** ids of macros that actually resolve right now (published, visible to
   *  this user) — anything outside this set is an ORPHAN_MACRO_REF. */
  knownMacroIds: Set<number>
  /** macro id -> ids of the macros IT references, derived from each
   *  macro's own last-published workspace. Used to walk past the macros
   *  directly referenced here to find an indirect cycle (A -> B -> A). */
  macroOutgoingRefs: Map<number, number[]>
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

/**
 * Safely parses a live block's `data` JSON payload — same format written by
 * blocklyParser.ts's 'macro_task' step: `{ id, name }`. Returns null on
 * anything malformed rather than throwing, matching the tolerant parsing
 * already used for entity blocks in blocks/mutators.ts.
 */
const parseMacroRefData = (
  rawData: unknown,
): { id?: unknown; name?: unknown } | null => {
  if (typeof rawData !== 'string' || rawData.length === 0) return null
  try {
    const parsed: unknown = JSON.parse(rawData)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

const MACRO_BLOCK_TYPE = 'macro_task_block'

/**
 * Recursively walks every block reachable from `root` (same traversal shape
 * as collectUnresolvedShadows: value inputs, statement inputs, next-chain)
 * collecting every macro_task_block reference found in the LIVE, currently
 * open workspace.
 */
const collectMacroTaskRefs = (
  block: Blockly.Block,
  found: MacroRef[] = [],
): MacroRef[] => {
  if (block.type === MACRO_BLOCK_TYPE) {
    const data = parseMacroRefData(block.data)
    if (data && typeof data.id === 'number') {
      found.push({
        id: data.id,
        name: typeof data.name === 'string' ? data.name : `Task ${data.id}`,
        blockId: block.id,
      })
    }
  }

  for (const input of block.inputList) {
    const connected = input.connection?.targetBlock()
    if (connected) collectMacroTaskRefs(connected, found)
  }

  const next = block.getNextBlock()
  if (next) collectMacroTaskRefs(next, found)

  return found
}

/**
 * Recursively walks a SERIALIZED (JSON) block subtree — the shape returned
 * by Blockly.serialization.blocks.save(), i.e. a macro's own
 * published_workspace — collecting every macro_task_block reference it
 * contains. Used to build the cross-macro dependency graph for cycle
 * detection (buildMacroOutgoingRefs below); the live-workspace walker above
 * can't be reused here since other macros' content only ever exists as
 * plain JSON fetched from the server, never as live Blockly Block instances.
 */
const collectMacroRefsFromSerializedNode = (
  node: Record<string, unknown>,
  found: MacroRef[] = [],
): MacroRef[] => {
  if (node['type'] === MACRO_BLOCK_TYPE) {
    const data = parseMacroRefData(node['data'])
    if (data && typeof data.id === 'number') {
      found.push({
        id: data.id,
        name: typeof data.name === 'string' ? data.name : `Task ${data.id}`,
      })
    }
  }

  const inputs = node['inputs'] as Record<string, unknown> | undefined
  if (inputs) {
    for (const slot of Object.values(inputs)) {
      const block = (slot as { block?: Record<string, unknown> } | undefined)
        ?.block
      if (block) collectMacroRefsFromSerializedNode(block, found)
    }
  }

  const next = node['next'] as { block?: Record<string, unknown> } | undefined
  if (next?.block) collectMacroRefsFromSerializedNode(next.block, found)

  return found
}

/**
 * Builds the id -> [referenced macro ids] graph used for cycle detection,
 * from each macro's own last-published workspace. `codeByMacroId` mirrors
 * task-workspace/index.tsx's macroDetailsById (id -> { code }), typed
 * narrowly here to keep this file decoupled from TaskDetailType.
 *
 * A macro's `code` is a serialized block tree — either a single top-level
 * block object, or (legacy shape, seen in persisted data) an array of
 * top-level block objects. Both are handled.
 */
export const buildMacroOutgoingRefs = (
  codeByMacroId: Record<number, { code: unknown }>,
): Map<number, number[]> => {
  const graph = new Map<number, number[]>()

  for (const [idStr, { code }] of Object.entries(codeByMacroId)) {
    const macroId = Number(idStr)
    if (!code) {
      graph.set(macroId, [])
      continue
    }
    const nodes = Array.isArray(code) ? code : [code]
    const refs = nodes.flatMap((node) =>
      typeof node === 'object' && node !== null
        ? collectMacroRefsFromSerializedNode(node as Record<string, unknown>)
        : [],
    )
    graph.set(macroId, Array.from(new Set(refs.map((r) => r.id))))
  }

  return graph
}

/**
 * Depth-first search from each directly-referenced macro, walking
 * macroOutgoingRefs, looking for a path that revisits a node already on the
 * current path — including looping back to currentTaskId itself. Mirrors
 * the runtime MAX_MACRO_DEPTH safety net's intent (simulate.py) but at
 * edit time: same DEPTH_CAP so a large-but-legitimately-deep dependency
 * tree can't hang the UI.
 */
const DEPTH_CAP = 64

const findMacroCycle = (
  startId: number,
  currentTaskId: number | null,
  macroOutgoingRefs: Map<number, number[]>,
): boolean => {
  const path = new Set<number>(currentTaskId !== null ? [currentTaskId] : [])

  const dfs = (nodeId: number, depth: number): boolean => {
    if (depth > DEPTH_CAP) return false
    if (path.has(nodeId)) return true
    path.add(nodeId)
    for (const next of macroOutgoingRefs.get(nodeId) ?? []) {
      if (dfs(next, depth + 1)) return true
    }
    path.delete(nodeId)
    return false
  }

  return dfs(startId, 0)
}

/**
 * Scans every reachable flow for macro_task_block references and returns
 * one warning per problem found: ORPHAN_MACRO_REF for a reference that
 * doesn't resolve to a currently-published macro, CIRCULAR_MACRO_REF for a
 * reference that (directly or transitively, via other macros' own
 * references) loops back to itself or to the task currently being edited.
 * A ref can be flagged for at most one of the two — an orphan can't
 * meaningfully participate in a cycle check.
 */
const collectMacroWarnings = (
  flowRoots: Blockly.Block[],
  macroContext: MacroContext,
): ConformanceIssue[] => {
  const refs = flowRoots.flatMap((root) => collectMacroTaskRefs(root))
  const warnings: ConformanceIssue[] = []

  for (const ref of refs) {
    if (!macroContext.knownMacroIds.has(ref.id)) {
      warnings.push({
        type: 'ORPHAN_MACRO_REF',
        severity: 'warning',
        blockId: ref.blockId ?? '',
        macroId: ref.id,
        macroName: ref.name,
      })
      continue
    }
    if (
      findMacroCycle(
        ref.id,
        macroContext.currentTaskId,
        macroContext.macroOutgoingRefs,
      )
    ) {
      warnings.push({
        type: 'CIRCULAR_MACRO_REF',
        severity: 'warning',
        blockId: ref.blockId ?? '',
        macroId: ref.id,
        macroName: ref.name,
      })
    }
  }

  return warnings
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
 *  5. macro_task_block referencing an unpublished/deleted/invisible task
 *     → warning ORPHAN_MACRO_REF (×N), only when macroContext is passed
 *  6. macro_task_block whose dependency chain loops back to itself or to
 *     the task being edited → warning CIRCULAR_MACRO_REF (×N), only when
 *     macroContext is passed
 *
 * Status is 'ready' only when there are zero errors (warnings are allowed).
 * Rules 5-6 are warnings, not errors, by design: the runtime already
 * survives both (a deleted macro no-ops at execution, a cycle is capped by
 * MAX_MACRO_DEPTH in simulate.py) — this is an early, non-blocking signal,
 * not a new gate on Save/Publish. See
 * docs/internal/analisi-sistema/p2-2-ciclo-vita-task.md §5 for why.
 *
 * Works identically regardless of whether the when_start block is present
 * (Detailed/Essential mode) or absent (Minimal mode). The start block is
 * treated as an ordinary root when present — traversal begins from its first
 * connected child to avoid false positives on the start block itself.
 */
export const computeConformance = (
  workspace: Blockly.Workspace,
  macroContext?: MacroContext,
): ConformanceResult => {
  // Collect all roots: enabled, non-shadow top-level blocks.
  const topBlocks = workspace
    .getTopBlocks(false)
    .filter((b) => b.isEnabled() && !isUnresolvedShadow(b))

  // ── Rule 1: empty workspace ──────────────────────────────────────────────
  // when_start is a permanent structural marker (inserted on every task load,
  // deletable:false) — a workspace holding only an empty when_start has no
  // real content, even though topBlocks.length is 1, not 0. A shadow next
  // block doesn't count as content either: insertStartBlock attaches a
  // shadow_start_sequence_block ("+" placeholder) by default on every fresh
  // task, so getNextBlock() alone is never null and the empty case was still
  // missed. Without both checks, a brand-new task never reports empty, so the
  // canvas's "drag a block to start" message only ever appeared after
  // deleting a task back down to nothing, never on first load.
  const realTopBlocks = topBlocks.filter((b) => {
    if (b.type !== START_BLOCK_TYPE) return true
    const next = b.getNextBlock()
    return next !== null && !isUnresolvedShadow(next)
  })
  if (realTopBlocks.length === 0) {
    return buildResult([{ type: 'EMPTY_WORKSPACE', severity: 'error' }], [])
  }

  // ── Identify the main flow root ──────────────────────────────────────────
  // Prefer the when_start block as root; otherwise take the first top block.
  const startBlock = topBlocks.find((b) => b.type === START_BLOCK_TYPE)
  const root = startBlock ?? topBlocks[0]

  // ── Rules 5-6: macro references, across every flow ───────────────────────
  // Computed once up front (independent of which error path below fires) so
  // fixing a blocking error doesn't hide an orphan/circular macro warning
  // that was already there — same reasoning as Rule 2's own comment below.
  const macroWarnings = macroContext
    ? collectMacroWarnings(
        topBlocks
          .map((top) =>
            top.type === START_BLOCK_TYPE ? (top.getNextBlock() ?? top) : top,
          )
          .filter((flowRoot) => !isUnresolvedShadow(flowRoot)),
        macroContext,
      )
    : []

  // ── Rule 2: multiple flows (error) ───────────────────────────────────────
  // If there are multiple disconnected top-level blocks, the workspace is
  // ambiguous. We enforce a single flow to consider the task 'ready' — but
  // still scan every flow for unresolved shadows (Rule 3) instead of
  // stopping here: otherwise connecting the flows just reveals a second
  // round of errors that were always there, one fix at a time.
  if (topBlocks.length > 1) {
    const errors: ConformanceIssue[] = [
      { type: 'MULTIPLE_FLOWS', severity: 'error', count: topBlocks.length },
    ]
    for (const top of topBlocks) {
      const flowRoot =
        top.type === START_BLOCK_TYPE ? (top.getNextBlock() ?? top) : top
      if (isUnresolvedShadow(flowRoot)) {
        errors.push(toShadowIssue(flowRoot))
      } else {
        errors.push(...collectUnresolvedShadows(flowRoot))
      }
    }
    return buildResult(errors, macroWarnings)
  }

  // ── Rule 3: unresolved shadow blocks in the main flow ────────────────────
  // When the root is when_start, begin traversal from its first child so the
  // start block itself is never misidentified as an unresolved slot.
  const traversalRoot =
    root.type === START_BLOCK_TYPE ? (root.getNextBlock() ?? root) : root

  if (isUnresolvedShadow(traversalRoot)) {
    return buildResult([toShadowIssue(traversalRoot)], macroWarnings)
  }

  const shadowErrors = collectUnresolvedShadows(traversalRoot)
  if (shadowErrors.length > 0) {
    return buildResult(shadowErrors, macroWarnings)
  }

  // ── All errors resolved ───────────────────────────────────────────────────
  return buildResult([], macroWarnings)
}

/**
 * Maps a ConformanceIssue to a human-readable, actionable string.
 * Suitable for tooltip content, aria-labels, and status messages.
 */
export const formatIssue = (issue: ConformanceIssue): string => {
  switch (issue.type) {
    case 'EMPTY_WORKSPACE':
      return "There's nothing here yet — add at least one block to start."
    case 'MULTIPLE_FLOWS':
      return `${issue.count} separate groups of blocks aren't connected — connect them into one sequence.`
    case 'UNRESOLVED_SHADOW':
      return `"${issue.humanLabel}" requires a selection.`
    case 'FLOATING_BLOCK':
      return "A block isn't connected to the program — it won't run."
    case 'ORPHAN_MACRO_REF':
      return `Saved task "${issue.macroName}" isn't published (or isn't shared with you) — it can't run.`
    case 'CIRCULAR_MACRO_REF':
      return `Saved task "${issue.macroName}" eventually calls back into this task, forming a loop — it can't run.`
  }
}
