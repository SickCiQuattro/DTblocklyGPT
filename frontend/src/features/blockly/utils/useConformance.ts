/**
 * useConformance.ts
 *
 * React hook that tracks the conformance state of the active Blockly workspace
 * in real time. Subscribes to the Blockly workspace event stream and
 * re-computes on every structural change.
 *
 * Usage:
 *   const { status, isReady, issues, formattedIssues } = useConformance(workspace)
 *
 * Returns a stable Draft/EMPTY_WORKSPACE result when workspace is null
 * (before the workspace has been injected or after it has been disposed).
 *
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import * as Blockly from 'blockly/core'

import {
  computeConformance,
  formatIssue,
  type ConformanceIssue,
  type ConformanceResult,
  type TaskStatus,
} from './conformance'

// ─── Events that require re-evaluation ───────────────────────────────────────
// Only structural events trigger a recompute. Cosmetic / UI events
// (VIEWPORT_CHANGE, BLOCK_DRAG, SELECTED, CLICK, UI) are intentionally
// excluded to avoid unnecessary renders.

const STRUCTURAL_EVENTS = new Set([
  String(Blockly.Events.BLOCK_CREATE),
  String(Blockly.Events.BLOCK_DELETE),
  String(Blockly.Events.BLOCK_MOVE),
  String(Blockly.Events.BLOCK_CHANGE),
])

// ─── Initial state ────────────────────────────────────────────────────────────

const EMPTY_RESULT: ConformanceResult = {
  status: 'draft',
  issues: [{ type: 'EMPTY_WORKSPACE', severity: 'error' }],
  errors: [{ type: 'EMPTY_WORKSPACE', severity: 'error' }],
  warnings: [],
}

// ─── Public interface ─────────────────────────────────────────────────────────

export interface UseConformanceResult {
  /** 'draft' | 'ready' */
  status: TaskStatus
  /** Convenience boolean — true when status === 'ready' */
  isReady: boolean
  /** Structured list of active issues */
  issues: ConformanceIssue[]
  errors: ConformanceIssue[]
  warnings: ConformanceIssue[]
  hasWarnings: boolean
  formattedIssues: string[]
  formattedErrors: string[]
  formattedWarnings: string[]
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribes to Blockly workspace events and returns live conformance state.
 *
 * @param workspace - The active WorkspaceSvg, or null before injection.
 * @param showBlockWarnings - Set the native Blockly warning icon on unresolved
 *   shadow blocks. Only meaningful in 'complete' block view mode — the other
 *   modes hide the shadow's text label, so the warning bubble text ("X
 *   requires a selection") would reference a label the user can't see next to
 *   it. Default true for callers that don't care about view mode.
 */
export const useConformance = (
  workspace: Blockly.WorkspaceSvg | null,
  showBlockWarnings = true,
): UseConformanceResult => {
  const [result, setResult] = useState<ConformanceResult>(EMPTY_RESULT)

  // Stable ref so the event listener closure never captures a stale workspace.
  const workspaceRef = useRef(workspace)
  useEffect(() => {
    workspaceRef.current = workspace
  })

  // Tracks which block ids currently carry a native Blockly warning bubble, so
  // a shadow that gets resolved has its warning cleared even though it's no
  // longer in `result.errors` to tell us which block that was. Also stashes
  // each block's own tooltip while warned: shadow blocks ship with a static
  // instructional tooltip (e.g. "Connect the first block of your program
  // here."), and Blockly's hover-tooltip fires over the warning icon too —
  // right when the warning bubble is the more relevant thing to read. Blanking
  // the tooltip while warned (and restoring it once resolved) removes that
  // clash without touching the icon/bubble rendering itself.
  const warnedBlockIdsRef = useRef<Map<string, Blockly.Block['tooltip']>>(
    new Map(),
  )

  const recompute = useCallback(() => {
    const ws = workspaceRef.current
    const next = ws ? computeConformance(ws) : EMPTY_RESULT
    setResult(next)

    if (!ws) return

    // Surface the already-computed diagnosis on the exact block that's
    // blocking Save/Publish, via Blockly's own warning-icon mechanism — same
    // API already used for missing entity selections (blocks/mutators.ts).
    const currentlyWarned = new Map<string, Blockly.Block['tooltip']>()
    if (showBlockWarnings) {
      for (const issue of next.errors) {
        if (issue.type === 'UNRESOLVED_SHADOW') {
          const block = ws.getBlockById(issue.blockId)
          if (block) {
            block.setWarningText(formatIssue(issue))
            currentlyWarned.set(
              issue.blockId,
              warnedBlockIdsRef.current.get(issue.blockId) ?? block.tooltip,
            )
            block.tooltip = ''
          }
        }
      }
    }
    for (const [id, originalTooltip] of warnedBlockIdsRef.current) {
      if (!currentlyWarned.has(id)) {
        const block = ws.getBlockById(id)
        block?.setWarningText(null)
        if (block) block.tooltip = originalTooltip
      }
    }
    warnedBlockIdsRef.current = currentlyWarned
  }, [showBlockWarnings])

  useEffect(() => {
    if (!workspace) {
      setResult(EMPTY_RESULT)
      warnedBlockIdsRef.current = new Map()
      return
    }

    // Immediate evaluation so the badge is correct from the very first render
    // (e.g. after a task has been loaded into the workspace).
    recompute()

    const listener = (event: Blockly.Events.Abstract) => {
      // event.type is a string at runtime despite some TS overloads.
      if (STRUCTURAL_EVENTS.has(event.type)) {
        recompute()
      }
    }

    workspace.addChangeListener(listener)
    return () => {
      workspace.removeChangeListener(listener)
    }
  }, [workspace, recompute])

  return {
    status: result.status,
    isReady: result.errors.length === 0,
    issues: result.issues,
    errors: result.errors,
    warnings: result.warnings,
    hasWarnings: result.warnings.length > 0,
    formattedIssues: result.issues.map(formatIssue),
    formattedErrors: result.errors.map(formatIssue),
    formattedWarnings: result.warnings.map(formatIssue),
  }
}
