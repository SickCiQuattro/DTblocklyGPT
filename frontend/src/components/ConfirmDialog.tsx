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
  /** 'danger' (default) for destructive actions (terracotta accent), 'default' for neutral confirms (primary indigo). */
  tone?: 'danger' | 'default'
  /** Defaults to false for 'danger' tone, true for 'default' — a destructive dialog shouldn't
   * autofocus its own confirm button and fire on a stray Enter. Pass explicitly to override. */
  confirmOnEnter?: boolean
  /** Set while the confirmed action is in flight — shows a spinner on Confirm,
   * disables both buttons, and blocks closing via backdrop/Escape so the
   * dialog can't be dismissed mid-delete with no feedback either way. */
  loading?: boolean
}

// .dark, not .main — .main fails WCAG 1.4.3 with white text (accent 3.70:1,
// primary 4.47:1); .dark clears it (4.62:1 / 6.29:1).
const confirmButtonSx = (tone: 'danger' | 'default') => (theme: Theme) => ({
  textTransform: 'none' as const,
  backgroundColor:
    tone === 'danger' ? theme.palette.accent.dark : theme.palette.primary.dark,
  color:
    tone === 'danger'
      ? theme.palette.accent.contrastText
      : theme.palette.primary.contrastText,
  fontWeight: 600,
  borderRadius: '8px',
  px: 2,
  '&:hover': {
    backgroundColor:
      tone === 'danger'
        ? theme.palette.accent.darker
        : theme.palette.primary.darker,
  },
})

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
  confirmOnEnter = tone !== 'danger',
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
