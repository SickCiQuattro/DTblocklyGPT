/**
 * BlockSearchDialog.tsx
 *
 * Power-user command palette (Ctrl/Cmd+K): search step blocks by name and
 * insert the chosen one at the end of the program. Reuses the shadow-picker
 * catalog so names/groups stay in sync with the rest of the editor.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Dialog,
  DialogContent,
  List,
  ListItemButton,
  ListSubheader,
  TextField,
  Typography,
} from '@mui/material'

import { TaskType } from 'pages/tasks/types'
import { KeycapHint } from 'components/KeycapHint'

import { MENU_PAPER_SX } from '../menuStyles'
import {
  buildSequencePickerItems,
  filterShadowItems,
  getDotColour,
} from '../shadowPicker/catalog'
import type { ShadowPickerItem } from '../shadowPicker/types'

interface BlockSearchDialogProps {
  open: boolean
  onClose: () => void
  /** Insert the chosen block type at the end of the program. */
  onInsert: (item: ShadowPickerItem) => void
  /** Published macro tasks, shown as the "Saved Tasks" group. */
  macros: TaskType[]
}

export const BlockSearchDialog = ({
  open,
  onClose,
  onInsert,
  macros,
}: BlockSearchDialogProps) => {
  const [query, setQuery] = useState('')

  // Reset the query each time the palette opens.
  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  // Step-insertable blocks in toolbox order + published macros (Saved Tasks).
  const items = useMemo(() => buildSequencePickerItems(macros), [macros])
  const filtered = useMemo(
    () => filterShadowItems(items, query),
    [items, query],
  )

  const grouped = useMemo(() => {
    const out: Record<string, ShadowPickerItem[]> = {}
    for (const item of filtered) (out[item.group ?? 'Other'] ??= []).push(item)
    return out
  }, [filtered])

  const handleSelect = (item: ShadowPickerItem) => {
    onInsert(item)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      aria-label="Search blocks"
      slotProps={{ paper: { elevation: 0, sx: { ...MENU_PAPER_SX, mt: -10 } } }}
    >
      <DialogContent sx={{ p: 1.5 }}>
        <TextField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a block to add…"
          size="small"
          fullWidth
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && filtered[0]) handleSelect(filtered[0])
          }}
          slotProps={{
            input: {
              endAdornment: <KeycapHint>esc</KeycapHint>,
            },
          }}
        />
        <List dense sx={{ maxHeight: 360, overflowY: 'auto', mt: 1 }}>
          {filtered.length === 0 && (
            <Typography
              variant="body2"
              sx={{ color: 'text.secondary', px: 2, py: 1.5 }}
            >
              No blocks match “{query}”.
            </Typography>
          )}
          {Object.entries(grouped).map(([group, groupItems]) => (
            <Box component="li" key={group} sx={{ listStyle: 'none' }}>
              <ListSubheader
                component="div"
                disableSticky
                sx={{
                  fontSize: 11,
                  lineHeight: '24px',
                  color: 'text.secondary',
                }}
              >
                {group}
              </ListSubheader>
              <List dense disablePadding>
                {groupItems.map((item) => (
                  <ListItemButton
                    key={`${item.group}-${item.id}-${item.name}`}
                    onClick={() => handleSelect(item)}
                    sx={{ borderRadius: 1.5, py: 0.5 }}
                  >
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        mr: 1.25,
                        flexShrink: 0,
                        bgcolor: getDotColour(item.group ?? ''),
                      }}
                    />
                    <Box>
                      <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>
                        {item.name}
                      </Typography>
                      {item.description && (
                        <Typography
                          sx={{ fontSize: '0.78rem', color: 'text.secondary' }}
                        >
                          {item.description}
                        </Typography>
                      )}
                    </Box>
                  </ListItemButton>
                ))}
              </List>
            </Box>
          ))}
        </List>
      </DialogContent>
    </Dialog>
  )
}
