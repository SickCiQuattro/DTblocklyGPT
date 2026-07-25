import {
  Button,
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
  /** Default true. Set false for high-stakes irreversible actions (e.g. real robot motion) so
   * Enter/autofocus can't accidentally trigger the confirm button — focus lands on Cancel instead. */
  confirmOnEnter?: boolean
}

const confirmButtonSx = (tone: 'danger' | 'default') => (theme: Theme) => ({
  textTransform: 'none' as const,
  backgroundColor:
    tone === 'danger' ? theme.palette.accent.main : theme.palette.primary.main,
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
        ? theme.palette.accent.dark
        : theme.palette.primary.dark,
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
  confirmOnEnter = true,
}: ConfirmDialogProps) => (
  <Dialog
    open={open}
    onClose={onCancel}
    onKeyDown={(e) => {
      if (confirmOnEnter && e.key === 'Enter') {
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
        onClick={onConfirm}
        sx={confirmButtonSx(tone)}
      >
        {confirmLabel}
      </Button>
    </DialogActions>
  </Dialog>
)
