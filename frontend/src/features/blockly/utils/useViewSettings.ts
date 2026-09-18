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
  /**
   * Show the AND / OR / NOT condition operators in the toolbox and the shadow
   * picker.
   *
   * Off by default: they were pulled from the palette on advisor feedback,
   * because they ask a non-programmer to hold a boolean expression in mind.
   * The block types, the parser and the backend enums never went away — the
   * chat assistant can still produce them, and a task that contains them still
   * loads. Turning this on only puts them back where they can be reached by
   * hand.
   */
  showLogicOperators: boolean
}

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  blockViewMode: 'complete',
  deleteConfirmMode: 'multiple',
  showStartBlock: true,
  keyboardMode: false,
  gridVisible: true,
  snapToGrid: true,
  toolboxCollapsed: false,
  // On. The setting only scrolls when the running step has already gone
  // off-screen, so it does nothing whenever the program fits — free when
  // unneeded, and the only thing that helps when it is.
  //
  // Off was backwards for this layout. With Copilot and the robot panel open
  // on a 1440px laptop the canvas floor is 480px (WORKSPACE_MIN_PX 480, minus
  // the 240px toolbox, which does auto-collapse during a run); a program with
  // two conditions is already about twice that wide. So during a run half the
  // program sat off-screen and nothing brought the executing step into view —
  // and unlike a document, the operator cannot know where to scroll, because
  // the thing advancing is the robot, not the page.
  //
  // Note for anyone comparing behaviour: loadSettings merges stored values
  // over these defaults, so a browser that already has
  // `dtblockly.viewSettings` keeps whatever it had. This changes first runs.
  followRunningBlock: true,
  showLogicOperators: false,
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
