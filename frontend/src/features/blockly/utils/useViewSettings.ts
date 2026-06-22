import { useState, useEffect } from 'react'

export type BlockViewMode = 'complete' | 'essential' | 'minimal'
export type DeleteConfirmMode = 'always' | 'multiple' | 'never'

export interface ViewSettings {
  blockViewMode: BlockViewMode
  deleteConfirmMode: DeleteConfirmMode
  showStartBlock: boolean
  /** Force Blockly's keyboard-navigation visuals always-on (a11y preference). */
  keyboardMode: boolean
}

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  blockViewMode: 'complete',
  deleteConfirmMode: 'multiple',
  showStartBlock: true,
  keyboardMode: false,
}

const STORAGE_KEY = 'dtblockly.viewSettings'

const loadSettings = (): ViewSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_VIEW_SETTINGS, ...JSON.parse(raw) }
  } catch {
    // ponytail: corrupt/blocked storage → fall back to defaults
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
