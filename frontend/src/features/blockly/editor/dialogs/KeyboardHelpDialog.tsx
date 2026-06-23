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

// Blockly v13 built-in keyboard-navigation defaults. Single-letter shortcuts
// (M, W, T, D, X) only fire while the workspace has focus and you are not typing
// in a field. MOD resolves to Cmd on macOS, Ctrl elsewhere (Blockly's CTRL_CMD).
const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Tab', action: 'Move focus into the blocks workspace' },
  { keys: 'Arrow keys', action: 'Move between blocks, fields and connections' },
  { keys: 'Enter / Space', action: 'Edit a field, press a button, or confirm' },
  { keys: 'M', action: 'Pick up the selected block to move it' },
  {
    keys: 'Arrows, then Enter',
    action: 'While moving: position the block, then drop it (Esc cancels)',
  },
  { keys: 'W / T', action: 'Jump focus to the Workspace / Toolbox' },
  { keys: `${MOD}+Enter`, action: 'Open the block’s menu (also Shift+F10)' },
  { keys: 'D', action: 'Duplicate the selected block' },
  { keys: 'X', action: 'Disconnect the selected block' },
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
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
        Press Tab (or W) to focus the workspace first. Letter shortcuts work when
        a block is selected and you are not typing in a field.
      </Typography>
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
