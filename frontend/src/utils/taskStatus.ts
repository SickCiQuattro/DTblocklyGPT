import { alpha } from '@mui/material/styles'

import { tokenColor } from './tokenColors'

// Single source of truth for task lifecycle status → label + colors.
// Used by the tasks table, the workspace header badge, and the task form so the
// same status always renders identically (Nielsen H4 — consistency).

export type TaskStatus = 'draft' | 'published' | 'draft-in-progress'

export interface TaskStatusVisual {
  label: string
  color: string
  bg: string
  border: string
}

// The in-progress blue has no semantic theme token; defined once here.
const IN_PROGRESS_BLUE = '#3B82F6'

const visual = (label: string, color: string): TaskStatusVisual => ({
  label,
  color,
  bg: alpha(color, 0.08),
  border: alpha(color, 0.2),
})

// Maps any backend status string to its canonical visual treatment.
export const taskStatusVisual = (rawStatus?: string): TaskStatusVisual => {
  const s = rawStatus?.toLowerCase() ?? 'draft'
  if (s === 'published' || s === 'ready' || s === 'tested') {
    return visual('Published', tokenColor.successMain)
  }
  if (s === 'published_with_draft') {
    return visual('Draft in Progress', IN_PROGRESS_BLUE)
  }
  return visual('Draft', tokenColor.warningDark)
}
