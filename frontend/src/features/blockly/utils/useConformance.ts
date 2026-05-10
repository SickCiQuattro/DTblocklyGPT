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
  issues: [{ type: 'EMPTY_WORKSPACE' }],
}

// ─── Public interface ─────────────────────────────────────────────────────────

export interface UseConformanceResult {
  /** 'draft' | 'ready' */
  status: TaskStatus
  /** Convenience boolean — true when status === 'ready' */
  isReady: boolean
  /** Structured list of active issues */
  issues: ConformanceIssue[]
  /**
   * Pre-formatted, human-readable strings ready for tooltip / UI display.
   * Empty array when isReady is true.
   */
  formattedIssues: string[]
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribes to Blockly workspace events and returns live conformance state.
 *
 * @param workspace - The active WorkspaceSvg, or null before injection.
 */
export const useConformance = (
  workspace: Blockly.WorkspaceSvg | null,
): UseConformanceResult => {
  const [result, setResult] = useState<ConformanceResult>(EMPTY_RESULT)

  // Stable ref so the event listener closure never captures a stale workspace.
  const workspaceRef = useRef(workspace)
  useEffect(() => {
    workspaceRef.current = workspace
  })

  const recompute = useCallback(() => {
    const ws = workspaceRef.current
    setResult(ws ? computeConformance(ws) : EMPTY_RESULT)
  }, [])

  useEffect(() => {
    if (!workspace) {
      setResult(EMPTY_RESULT)
      return
    }

    // Immediate evaluation so the badge is correct from the very first render
    // (e.g. after a task has been loaded into the workspace).
    recompute()

    const listener = (event: Blockly.Events.Abstract) => {
      // event.type is a string at runtime despite some TS overloads.
      if (STRUCTURAL_EVENTS.has(event.type as string)) {
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
    isReady: result.status === 'ready',
    issues: result.issues,
    formattedIssues: result.issues.map(formatIssue),
  }
}
