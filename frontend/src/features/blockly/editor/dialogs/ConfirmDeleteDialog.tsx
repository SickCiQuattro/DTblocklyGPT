/**
 * ConfirmDeleteDialog.tsx
 *
 * Generic confirmation dialog shown before irreversible delete operations
 * in the Blockly workspace (deleting a block with children, or deleting all blocks).
 *
 * Pressing Enter triggers the confirm action; Escape or clicking outside closes
 * the dialog and fires `onCancel`.
 */

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material'

interface ConfirmDeleteDialogProps {
  /** Whether the dialog is currently visible. */
  open: boolean
  /** Message shown in the dialog body (e.g. "Delete 3 blocks?"). */
  message: string
  /** Called when the user confirms the delete action. */
  onConfirm: () => void
  /** Called when the user cancels or dismisses the dialog. */
  onCancel: () => void
}

/** Shared MUI `sx` style object for the delete confirm button. */
const deleteButtonSx = {
  textTransform: 'none',
  backgroundColor: '#E15930',
  color: '#FFFFFF',
  fontWeight: 600,
  borderRadius: '8px',
  px: 2,
  '&:hover': {
    backgroundColor: '#C84D28',
  },
} as const

/** Shared MUI `sx` style object for the cancel button. */
const cancelButtonSx = {
  textTransform: 'none',
  color: '#64748B',
  fontWeight: 600,
  borderRadius: '8px',
  px: 2,
  '&:hover': {
    backgroundColor: '#F1F5F9',
    color: '#0F172A',
  },
} as const

/**
 * Confirmation dialog that guards irreversible delete operations.
 * Renders a destructive (red) confirm button and a neutral cancel button.
 * The Enter key shortcut triggers `onConfirm` for keyboard-accessible workflows.
 */
export const ConfirmDeleteDialog = ({
  open,
  message,
  onConfirm,
  onCancel,
}: ConfirmDeleteDialogProps) => (
  <Dialog
    open={open}
    onClose={onCancel}
    onKeyDown={(e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm()
      }
    }}
    slotProps={{
      paper: {
        elevation: 0,
        sx: {
          borderRadius: '12px',
          border: '1px solid #E2E8F0',
          boxShadow:
            '0 12px 32px -4px rgba(15, 23, 42, 0.12), 0 4px 12px -2px rgba(15, 23, 42, 0.08)',
          p: 1.5,
          maxWidth: 400,
        },
      },
    }}
  >
    <DialogTitle
      sx={{
        fontWeight: 600,
        fontSize: '1.3rem',
        color: '#0F172A',
        pb: 1,
      }}
    >
      Confirm
    </DialogTitle>
    <DialogContent>
      <Typography variant="body2" sx={{ color: '#475569', lineHeight: 1.5 }}>
        {message}
      </Typography>
    </DialogContent>
    <DialogActions sx={{ px: 2, pb: 1.5, pt: 1, gap: 1 }}>
      <Button
        variant="text"
        disableElevation
        onClick={onCancel}
        sx={cancelButtonSx}
      >
        Cancel
      </Button>
      <Button
        variant="contained"
        disableElevation
        disableFocusRipple
        autoFocus
        onClick={onConfirm}
        sx={deleteButtonSx}
      >
        Delete
      </Button>
    </DialogActions>
  </Dialog>
)
