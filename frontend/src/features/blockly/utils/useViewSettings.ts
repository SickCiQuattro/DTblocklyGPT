import { useState } from 'react'

export type BlockViewMode = 'complete' | 'essential' | 'minimal'
export type DeleteConfirmMode = 'always' | 'multiple' | 'never'

export interface ViewSettings {
  blockViewMode: BlockViewMode
  deleteConfirmMode: DeleteConfirmMode
  showStartBlock: boolean
}

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  blockViewMode: 'complete',
  deleteConfirmMode: 'multiple',
  showStartBlock: true,
}

export const useViewSettings = () => {
  const [viewSettings, setViewSettings] = useState<ViewSettings>(
    DEFAULT_VIEW_SETTINGS,
  )

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
