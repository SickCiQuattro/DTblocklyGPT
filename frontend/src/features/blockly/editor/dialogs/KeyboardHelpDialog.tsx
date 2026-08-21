/**
 * KeyboardHelpDialog.tsx
 *
 * Renders the shortcut list so keyboard-only and screen-reader users can
 * discover it. The list itself lives in `../appShortcuts` — this file used to
 * own a hand-maintained copy, which is how it came to document two shortcuts
 * (`T`, `H`) that do nothing in this integration. Add or change entries there,
 * not here.
 *
 * This list is the project's WCAG 2.1.4 evidence: single-character shortcuts DO
 * exist (mostly Blockly's, and keyboard navigation is force-enabled in
 * BlocklyEditor), so the criterion is met by the "active only on focus"
 * exception — not by their absence.
 */
import {
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material'
import { X } from 'lucide-react'

import { KeycapHint } from 'components/KeycapHint'

import { SHORTCUT_ROWS } from '../appShortcuts'

interface KeyboardHelpDialogProps {
  open: boolean
  onClose: () => void
}

export const KeyboardHelpDialog = ({
  open,
  onClose,
}: KeyboardHelpDialogProps) => (
  <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
    <DialogTitle
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      Keyboard shortcuts
      <IconButton onClick={onClose} size="small" aria-label="Close">
        <X size={18} />
      </IconButton>
    </DialogTitle>
    <DialogContent>
      <Typography
        variant="caption"
        sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}
      >
        Press Tab (or W) to focus the workspace first. Letter shortcuts work
        when a block is selected and you are not typing in a field.
      </Typography>
      <Stack spacing={1}>
        {SHORTCUT_ROWS.map(({ keys, description }) => (
          <Stack
            key={keys}
            direction="row"
            spacing={2}
            sx={{ alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {description}
            </Typography>
            <KeycapHint sx={{ whiteSpace: 'nowrap' }}>{keys}</KeycapHint>
          </Stack>
        ))}
      </Stack>
    </DialogContent>
  </Dialog>
)
