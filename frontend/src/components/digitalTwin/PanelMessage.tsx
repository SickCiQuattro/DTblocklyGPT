/**
 * One shape for every message the robot panel shows the operator.
 *
 * The panel had grown sixteen distinct message surfaces — four banners at the
 * top of the scroll body, three overlays on the video, five notices in the Run
 * section, a footer list, and a global toast — each with its own padding, icon
 * size, tint, lifetime and ARIA role. The same event class could arrive in two
 * different places (a successful Stop was a toast, a failed Stop was a banner),
 * and the same colour carried three unrelated meanings.
 *
 * This file fixes the *shape*. Two rules it enforces that a style guide could
 * only ask for politely:
 *
 * 1. **Amber cannot appear in a runtime banner.** Across this panel amber means
 *    exactly one thing — the physical arm is involved (the Run button on the
 *    real target, the live-hardware notice, the confirm dialog). `RuntimeTone`
 *    excludes it structurally, so a timeout or an abort cannot borrow it and
 *    dilute the one meaning the operator has learned. tsc rejects it; no review
 *    needed.
 * 2. **Announcing is opt-in.** A live region is for something that *becomes*
 *    true while the operator is looking elsewhere. The pre-run notices are just
 *    there when the panel opens, and marking them live made a screen reader
 *    read the whole Run section aloud on mount.
 */
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'

import { panel, panelType } from './panelTokens'

/**
 * The panel's whole colour vocabulary, and what each colour is allowed to mean.
 * Adding a fifth tone is almost always the wrong fix: it means a message has
 * not been classified, not that the vocabulary is short.
 */
export type MessageTone =
  /** Something failed, or stopped, and the operator has to know. */
  | 'danger'
  /** In progress, or a fact worth stating. Carries no alarm. */
  | 'info'
  /** Finished cleanly, or a safety guarantee ("the arm cannot move"). */
  | 'success'
  /** Reserved: the physical arm is involved. Never anything else. */
  | 'hardware'

/**
 * Tones a *runtime* banner may use. Amber is deliberately absent — see rule 1
 * in the file header. A run-time event is never about hardware being armed;
 * it is about something that happened.
 */
export type RuntimeTone = Exclude<MessageTone, 'hardware'>

/**
 * The single transient lifetime, from the panel's duration rule:
 *
 *   - a message that DESCRIBES A STATE lasts as long as the state
 *     (a wait in progress, a dead camera feed, a timed-out step);
 *   - a message that REPORTS AN EVENT with nothing left to handle lasts
 *     `MESSAGE_TTL_MS` (a step completed, a "Show message", a clean finish);
 *   - a message that REPORTS AN EVENT WITH AN OPEN CONSEQUENCE stays until the
 *     operator dismisses it (a task aborted, a failed halt, an arm still
 *     holding what it picked up).
 *
 * Before the rule there were four different lifetimes — 2 s, 4 s, 5 s and
 * forever — chosen per call site with no criterion.
 */
export const MESSAGE_TTL_MS = 4000

const TONES: Record<
  MessageTone,
  { fg: string; tint: (o: number) => string; icon: LucideIcon }
> = {
  danger: { fg: panel.error, tint: panel.errorTint, icon: AlertTriangle },
  info: { fg: panel.primaryFaint, tint: panel.primaryTint, icon: Info },
  success: {
    fg: panel.successLight,
    tint: panel.successTint,
    icon: CheckCircle2,
  },
  hardware: {
    fg: panel.warningLight,
    tint: panel.warningTint,
    icon: AlertTriangle,
  },
}

export interface PanelMessageProps {
  tone: MessageTone
  /** Overrides the tone's default icon where the subject has its own (a camera,
   *  a microphone, a screen). The tone still decides the colour. */
  icon?: LucideIcon
  children: React.ReactNode
  /** Present only on messages with an open consequence — see the duration rule. */
  onDismiss?: () => void
  /** Pre-run notices sit at 0.72rem; runtime banners carry more weight. */
  dense?: boolean
  /**
   * Announce to assistive tech when this appears. Opt-in: true for things that
   * BECOME true during a run, false for notices that are simply present.
   */
  announce?: boolean
  /** Trailing control, e.g. the inline fix on a pre-flight issue. */
  action?: React.ReactNode
}

export function PanelMessage({
  tone,
  icon,
  children,
  onDismiss,
  dense = false,
  announce = false,
  action,
}: PanelMessageProps) {
  const { fg, tint, icon: ToneIcon } = TONES[tone]
  const Icon = icon ?? ToneIcon

  return (
    <Box
      // Only danger interrupts. Everything else waits its turn: a polite region
      // that fires on every step of a run is noise a screen-reader user cannot
      // switch off, which is how the STATUS line ended up being the panel's
      // only reliable announcement.
      {...(announce
        ? {
            role: tone === 'danger' ? 'alert' : 'status',
            'aria-live': tone === 'danger' ? 'assertive' : 'polite',
          }
        : {})}
      sx={{
        display: 'flex',
        alignItems: onDismiss || action ? 'flex-start' : 'center',
        gap: '10px',
        padding: dense ? '8px 12px' : '10px 14px',
        background: tint(dense ? 0.1 : 0.12),
        border: `1px solid ${tint(dense ? 0.3 : 0.35)}`,
        borderRadius: '8px',
      }}
    >
      <Icon size={15} color={fg} style={{ marginTop: '1px', flexShrink: 0 }} />
      <Typography
        sx={{
          fontSize: dense ? panelType.small : panelType.body,
          fontWeight: dense ? 400 : 500,
          // The tone rides the icon in dense mode and the text as well in a
          // banner. Five stacked pre-run notices in five saturated colours read
          // as five alarms; one banner at a time can afford the full weight.
          color: dense ? panel.textDim : fg,
          flex: 1,
          lineHeight: 1.45,
        }}
      >
        {children}
      </Typography>
      {action}
      {onDismiss && (
        <IconButton
          size="small"
          aria-label="Dismiss"
          onClick={onDismiss}
          sx={{ padding: '2px', marginTop: '-2px', flexShrink: 0 }}
        >
          <X size={14} color={fg} />
        </IconButton>
      )}
    </Box>
  )
}
