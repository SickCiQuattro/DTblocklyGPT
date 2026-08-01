import { alpha } from '@mui/material/styles'
import { Pencil, CheckCircle2, LucideIcon } from 'lucide-react'

import { UI_TEXT } from 'constants/uiVocabulary'

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
  /**
   * Set only for `published_with_draft` — a published version of the task
   * exists (so the chip itself says "Published", same as a clean publish),
   * but it can't run: a newer edit sits unpublished on top of it, so the
   * task must be published or discarded first. Render this as a small
   * secondary note next to the chip, never as a separate "Draft"-prefixed
   * status — see docs/internal on the "three axes called draft" fix.
   */
  secondaryLabel?: string
  secondaryColor?: string
}

const visual = (
  label: string,
  color: string,
  text: string,
  icon: LucideIcon,
  extra?: { secondaryLabel: string; secondaryColor: string },
): TaskStatusVisual => ({
  label,
  color,
  text,
  bg: alpha(color, 0.08),
  border: alpha(color, 0.2),
  icon,
  ...extra,
})

// Maps any backend status string to its canonical visual treatment.
export const taskStatusVisual = (rawStatus?: string): TaskStatusVisual => {
  const s = rawStatus?.toLowerCase() ?? 'draft'
  if (s === 'published' || s === 'ready' || s === 'tested') {
    // successMain (#10B981) on an 8%-self tint is 2.35:1 — text uses the
    // darker step (#047857, ~5.5:1) instead; dot/border stay on main.
    return visual(
      UI_TEXT.published,
      tokenColor.successMain,
      tokenColor.successDarker,
      CheckCircle2,
    )
  }
  if (s === 'published_with_draft') {
    // Same chip as a clean publish (a published version does exist, it's
    // just not the version that would run) — the cyan "in progress" hue
    // moves to a secondary note instead of being the chip's own color, so
    // filtering by "Published" never shows a card whose chip visibly
    // contradicts the filter.
    return visual(
      UI_TEXT.published,
      tokenColor.successMain,
      tokenColor.successDarker,
      CheckCircle2,
      {
        secondaryLabel: UI_TEXT.unpublishedChanges,
        secondaryColor: tokenColor.inProgressDark,
      },
    )
  }
  // warningDark (#D97706) on its own 8% tint is 2.93:1, and even warningDarker
  // only clears ~4.25:1 on the app's #F5F5F7 background (just under AA) — the
  // warning hue's darker step isn't dark enough at this tint. contrastText
  // (the ink already used wherever warning carries a solid fill) clears
  // 14:1+ instead.
  return visual(
    UI_TEXT.draft,
    tokenColor.warningDark,
    tokenColor.warningContrastText,
    Pencil,
  )
}
