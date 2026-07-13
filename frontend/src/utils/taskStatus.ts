import { alpha } from '@mui/material/styles'
import { Pencil, CheckCircle2, Clock, LucideIcon } from 'lucide-react'

import { tokenColor } from './tokenColors'

// Single source of truth for task lifecycle status → label + colors.
// Used by the tasks table, the workspace header badge, and the task form so the
// same status always renders identically (Nielsen H4 — consistency).

export type TaskStatus = 'draft' | 'published' | 'draft-in-progress'

export interface TaskStatusVisual {
  label: string
  /** Icon/dot color — the chip's main hue, used at low alpha for bg/border. */
  color: string
  /** Label + icon color — darker than `color` so text clears 4.5:1 on the tint. */
  text: string
  bg: string
  border: string
  icon: LucideIcon
}

const visual = (
  label: string,
  color: string,
  text: string,
  icon: LucideIcon,
): TaskStatusVisual => ({
  label,
  color,
  text,
  bg: alpha(color, 0.08),
  border: alpha(color, 0.2),
  icon,
})

// Maps any backend status string to its canonical visual treatment.
export const taskStatusVisual = (rawStatus?: string): TaskStatusVisual => {
  const s = rawStatus?.toLowerCase() ?? 'draft'
  if (s === 'published' || s === 'ready' || s === 'tested') {
    // successMain (#10B981) on an 8%-self tint is 2.35:1 — text uses the
    // darker step (#047857, ~5.5:1) instead; dot/border stay on main.
    return visual(
      'Published',
      tokenColor.successMain,
      tokenColor.successDarker,
      CheckCircle2,
    )
  }
  if (s === 'published_with_draft') {
    return visual(
      'Draft in Progress',
      tokenColor.inProgressMain,
      tokenColor.inProgressDark,
      Clock,
    )
  }
  // warningDark (#D97706) on its own 8% tint is 2.93:1 — bump text to darker.
  return visual(
    'Draft',
    tokenColor.warningDark,
    tokenColor.warningDarker,
    Pencil,
  )
}
