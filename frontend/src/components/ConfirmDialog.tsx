import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Theme,
  Typography,
} from '@mui/material'

interface ConfirmDialogProps {
  /** Whether the dialog is currently visible. */
  open: boolean
  /** Message shown in the dialog body (e.g. "Delete this object?"). */
  message: string
  /** Called when the user confirms the action. */
  onConfirm: () => void
  /** Called when the user cancels or dismisses the dialog. */
  onCancel: () => void
  /** Dialog title. Default "Confirm" — override for higher-stakes actions (e.g. "Run on the real robot?"). */
  title?: string
  /** Confirm button label. Default "Confirm". */
  confirmLabel?: string
  /**
   * 'danger' (default) — destructive: something is deleted or overwritten.
   *   Terracotta, the palette's documented delete affordance.
   * 'caution' — consequential but not destructive: the PHYSICAL ARM will move.
   *   Amber, the same colour the robot panel's run button and its live-hardware
   *   banner already carry, so one colour means one thing across the app.
   * 'default' — ordinary confirm. Primary indigo.
   *
   * Starting the real robot used to be 'danger', which was wrong twice: it is
   * not destructive, and red is already the Stop button during a run — the two
   * opposite actions shared a colour on a cell with a physical arm in it.
   */
  tone?: 'danger' | 'caution' | 'default'
  /** Defaults to true only for the 'default' tone — neither a destructive
   * dialog nor one that moves the real arm should autofocus its own confirm
   * button and fire on a stray Enter. Pass explicitly to override. */
  confirmOnEnter?: boolean
  /** Set while the confirmed action is in flight — shows a spinner on Confirm,
   * disables both buttons, and blocks closing via backdrop/Escape so the
   * dialog can't be dismissed mid-delete with no feedback either way. */
  loading?: boolean
}

// .dark, not .main — .main fails WCAG 1.4.3 with white text (accent 3.70:1,
// primary 4.47:1); .dark clears it (4.62:1 / 6.29:1).
// .dark/.darker, not .main — see the note above on contrast. Amber is the
// exception that proves it: warning.main with white text is 2.15:1, so the
// caution tone pairs warning.main with the theme's designated ink
// (warning.contrastText), the same pairing the robot panel's run button uses.
const TONE_COLOURS = (theme: Theme) =>
  ({
    danger: {
      bg: theme.palette.accent.dark,
      bgHover: theme.palette.accent.darker,
      ink: theme.palette.accent.contrastText,
    },
    caution: {
      // main, not dark — on amber the ink pairing gets WORSE as the colour
      // darkens: main/ink is 7.94:1, dark/ink 5.35:1, darker/ink 3.40:1, which
      // fails AA. So this goes the opposite way from the other two tones, and
      // lands on exactly the pair the robot panel's run button already uses.
      bg: theme.palette.warning.main,
      bgHover: theme.palette.warning.dark,
      ink: theme.palette.warning.contrastText,
    },
    default: {
      bg: theme.palette.primary.dark,
      bgHover: theme.palette.primary.darker,
      ink: theme.palette.primary.contrastText,
    },
  }) as const

const confirmButtonSx =
  (tone: 'danger' | 'caution' | 'default') => (theme: Theme) => {
    const c = TONE_COLOURS(theme)[tone]
    return {
      textTransform: 'none' as const,
      backgroundColor: c.bg,
      color: c.ink,
      fontWeight: 600,
      borderRadius: '8px',
      px: 2,
      '&:hover': { backgroundColor: c.bgHover },
    }
  }

const cancelButtonSx = (theme: Theme) => ({
  textTransform: 'none' as const,
  color: theme.palette.slate[500],
  fontWeight: 600,
  borderRadius: '8px',
  px: 2,
  '&:hover': {
    backgroundColor: theme.palette.slate[100],
    color: theme.palette.slate[900],
  },
})

/**
 * The one confirmation modal used across the app — deletes, discards, and
 * any other "are you sure" moment. Centered dialog, not an inline popover,
 * so a destructive confirm always reads the same way regardless of where
 * it's triggered from.
 */
export const ConfirmDialog = ({
  open,
  message,
  onConfirm,
  onCancel,
  title = 'Confirm',
  confirmLabel = 'Confirm',
  tone = 'danger',
  // Neither a destructive dialog nor one that starts the physical arm should
  // fire on a stray Enter; only an ordinary confirm may.
  confirmOnEnter = tone === 'default',
  loading = false,
}: ConfirmDialogProps) => (
  <Dialog
    open={open}
    onClose={loading ? undefined : onCancel}
    onKeyDown={(e) => {
      if (loading) return

      // Left/Right move between the two buttons. A two-button dialog reads as
      // one horizontal choice, and that is how people drive one in every other
      // app; requiring Tab for a choice this small is the kind of thing that
      // makes keyboard use feel like a workaround. Tab still works — this is
      // an addition, not a replacement.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const buttons = Array.from(
          e.currentTarget.querySelectorAll<HTMLButtonElement>(
            'button:not([disabled])',
          ),
        )
        if (buttons.length < 2) return
        const current = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        )
        // Focus sitting on the dialog body rather than a button: enter the row
        // from the end the arrow points at, instead of doing nothing.
        const next =
          current === -1
            ? e.key === 'ArrowRight'
              ? 0
              : buttons.length - 1
            : (current + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) %
              buttons.length
        e.preventDefault()
        buttons[next].focus()
        return
      }

      // Only step in when Enter lands outside our own buttons — a focused
      // Cancel/Confirm button already activates on Enter natively, and
      // intervening there would preventDefault the button's own click and
      // fire onConfirm instead, even with focus on Cancel.
      if (
        confirmOnEnter &&
        e.key === 'Enter' &&
        (e.target as HTMLElement).tagName !== 'BUTTON'
      ) {
        e.preventDefault()
        onConfirm()
      }
    }}
    slotProps={{
      paper: { elevation: 0, sx: { p: 1.5, maxWidth: 400 } },
    }}
  >
    <DialogTitle sx={{ pb: 1 }}>{title}</DialogTitle>
    <DialogContent>
      <Typography
        variant="body2"
        sx={(theme) => ({ color: theme.palette.slate[600], lineHeight: 1.5 })}
      >
        {message}
      </Typography>
    </DialogContent>
    <DialogActions sx={{ px: 2, pb: 1.5, pt: 1, gap: 1 }}>
      <Button
        variant="text"
        disableElevation
        autoFocus={!confirmOnEnter}
        disabled={loading}
        onClick={onCancel}
        sx={cancelButtonSx}
      >
        Cancel
      </Button>
      <Button
        variant="contained"
        disableElevation
        disableFocusRipple
        autoFocus={confirmOnEnter}
        disabled={loading}
        onClick={onConfirm}
        startIcon={
          loading ? <CircularProgress size={14} color="inherit" /> : undefined
        }
        sx={confirmButtonSx(tone)}
      >
        {confirmLabel}
      </Button>
    </DialogActions>
  </Dialog>
)
