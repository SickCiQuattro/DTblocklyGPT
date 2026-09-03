import { useState, useEffect } from 'react'

export type BlockViewMode = 'complete' | 'essential' | 'minimal'
export type DeleteConfirmMode = 'always' | 'multiple' | 'never'

export interface ViewSettings {
  blockViewMode: BlockViewMode
  deleteConfirmMode: DeleteConfirmMode
  showStartBlock: boolean
  /** Force Blockly's keyboard-navigation visuals always-on (a11y preference). */
  keyboardMode: boolean
  // ── Advanced (power-user) ──
  /** Show the alignment grid lines. */
  gridVisible: boolean
  /** Snap blocks to the grid while dragging. */
  snapToGrid: boolean
  /** Hide the blocks sidebar (toolbox) — add blocks with Cmd/Ctrl+K instead. */
  toolboxCollapsed: boolean
  /**
   * Scroll the canvas to the step the robot is running, when it is off-screen.
   *
   * Off by default. An earlier always-on version was removed because it
   * recentred on every step and fought whoever was panning; this one only
   * intervenes when the running block is actually outside the viewport, and
   * even then it is opt-in.
   */
  followRunningBlock: boolean
}

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  blockViewMode: 'complete',
  deleteConfirmMode: 'multiple',
  showStartBlock: true,
  keyboardMode: false,
  gridVisible: true,
  snapToGrid: true,
  toolboxCollapsed: false,
  followRunningBlock: false,
}

const STORAGE_KEY = 'dtblockly.viewSettings'

const loadSettings = (): ViewSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_VIEW_SETTINGS, ...JSON.parse(raw) }
  } catch {
    // Corrupt/blocked storage — fall back to defaults.
  }
  return DEFAULT_VIEW_SETTINGS
}

export const useViewSettings = () => {
  const [viewSettings, setViewSettings] = useState<ViewSettings>(loadSettings)

  // Persist so settings survive reload (previously reset on every mount).
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(viewSettings))
    } catch {
      // ignore write failures (private mode / quota)
    }
  }, [viewSettings])

  const updateViewSettings = (patch: Partial<ViewSettings>) => {
    setViewSettings((prev) => ({ ...prev, ...patch }))
  }

  const resetViewSettings = () => {
    setViewSettings(DEFAULT_VIEW_SETTINGS)
  }

  return {
    viewSettings,
    updateViewSettings,
    resetViewSettings,
  }
}
