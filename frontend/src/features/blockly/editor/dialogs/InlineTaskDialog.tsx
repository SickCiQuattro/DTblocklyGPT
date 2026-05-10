/**
 * InlineTaskDialog.tsx
 *
 * Confirmation dialog shown before the "Break into steps" operation that replaces
 * a `macro_task_block` with its constituent block chain.
 *
 * The operation is irreversible in practical terms (an undo is technically
 * possible but editing the expanded blocks before undoing will corrupt the
 * undo stack), so the dialog includes an amber warning note.
 */

import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material'

interface InlineTaskDialogProps {
  /** Whether the dialog is currently visible. */
  open: boolean
  /** Human-readable name of the macro being inlined (shown in the body copy). */
  macroName: string
  /** Called when the user confirms the inline operation. */
  onConfirm: () => void
  /** Called when the user cancels or dismisses the dialog. */
  onCancel: () => void
}

/**
 * Warning dialog for the irreversible "Break into steps" context-menu action.
 * Shows the macro name and an amber caution notice before proceeding.
 */
export const InlineTaskDialog = ({
  open,
  macroName,
  onConfirm,
  onCancel,
}: InlineTaskDialogProps) => (
  <Dialog
    open={open}
    onClose={onCancel}
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
      Break into steps
    </DialogTitle>
    <DialogContent>
      <Typography variant="body2" sx={{ color: '#475569', lineHeight: 1.5 }}>
        This will replace the{' '}
        <strong style={{ color: '#0F172A' }}>{macroName}</strong> block with its
        individual steps.
      </Typography>

      {/* Amber caution notice — inlining can make undo difficult */}
      <Box
        sx={{
          mt: 1.5,
          p: 1,
          backgroundColor: '#FFF7ED',
          borderRadius: '6px',
          border: '1px solid #FFEDD5',
        }}
      >
        <Typography
          variant="body2"
          sx={{
            color: '#C2410C',
            lineHeight: 1.4,
            fontSize: '0.8rem',
            fontWeight: 500,
          }}
        >
          Note: You can undo this right away, but making changes to the expanded
          blocks will prevent you from easily reverting to the single block.
        </Typography>
      </Box>
    </DialogContent>
    <DialogActions sx={{ px: 2, pb: 1.5, pt: 1, gap: 1 }}>
      <Button
        variant="text"
        disableElevation
        onClick={onCancel}
        sx={{
          textTransform: 'none',
          color: '#64748B',
          fontWeight: 600,
          borderRadius: '8px',
          px: 2,
          '&:hover': {
            backgroundColor: '#F1F5F9',
            color: '#0F172A',
          },
        }}
      >
        Cancel
      </Button>
      <Button
        variant="contained"
        disableElevation
        disableFocusRipple
        autoFocus
        onClick={onConfirm}
        sx={{
          textTransform: 'none',
          backgroundColor: '#E15930',
          color: '#FFFFFF',
          fontWeight: 600,
          borderRadius: '8px',
          px: 2,
          '&:hover': {
            backgroundColor: '#C84D28',
          },
        }}
      >
        Break into steps
      </Button>
    </DialogActions>
  </Dialog>
)
