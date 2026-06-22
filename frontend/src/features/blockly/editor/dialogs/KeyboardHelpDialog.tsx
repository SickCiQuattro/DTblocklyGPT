/**
 * KeyboardHelpDialog.tsx
 *
 * Lists Blockly's standard keyboard-navigation shortcuts (built in since v13)
 * so keyboard-only and screen-reader users can discover them. We intentionally
 * use Blockly's standard shortcuts rather than inventing our own, per the
 * Blockly accessibility best-practices guide.
 */
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material'
import { X } from 'lucide-react'

interface KeyboardHelpDialogProps {
  open: boolean
  onClose: () => void
}

// OS-aware modifier label (Cmd on macOS, Ctrl elsewhere).
const MOD =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? 'Cmd'
    : 'Ctrl'

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Tab / Shift+Tab', action: 'Move focus into / out of the workspace' },
  { keys: 'Arrow keys', action: 'Move between blocks, connections and fields' },
  { keys: 'Enter / Space', action: 'Select, edit a field, or confirm' },
  { keys: 'Esc', action: 'Cancel, exit move mode, or close a menu' },
  { keys: 'Delete / Backspace', action: 'Delete the selected block' },
  { keys: `${MOD}+C / ${MOD}+X / ${MOD}+V`, action: 'Copy / cut / paste' },
  { keys: `${MOD}+Z / ${MOD}+Shift+Z`, action: 'Undo / redo' },
]

export const KeyboardHelpDialog = ({
  open,
  onClose,
}: KeyboardHelpDialogProps) => (
  <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
    <DialogTitle
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
    >
      Keyboard shortcuts
      <IconButton onClick={onClose} size="small" aria-label="Close">
        <X size={18} />
      </IconButton>
    </DialogTitle>
    <DialogContent>
      <Stack spacing={1}>
        {SHORTCUTS.map(({ keys, action }) => (
          <Stack
            key={keys}
            direction="row"
            spacing={2}
            sx={{ alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {action}
            </Typography>
            <Box
              component="kbd"
              sx={{
                fontFamily: 'monospace',
                fontSize: 12,
                whiteSpace: 'nowrap',
                px: 1,
                py: 0.25,
                borderRadius: 1,
                bgcolor: 'action.hover',
                color: 'text.primary',
              }}
            >
              {keys}
            </Box>
          </Stack>
        ))}
      </Stack>
    </DialogContent>
  </Dialog>
)
