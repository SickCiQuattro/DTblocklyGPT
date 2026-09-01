/**
 * BlockSearchDialog.tsx
 *
 * Power-user command palette (Ctrl/Cmd+K): search step blocks by name and
 * insert the chosen one at the end of the program. Reuses the shadow-picker
 * catalog so names/groups stay in sync with the rest of the editor.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
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
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const highlightedRef = useRef<HTMLDivElement>(null)

  // Reset the query each time the palette opens.
  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  // Escape closes the palette. Not left to MUI's own escapeKeyDown, and not a
  // React onKeyDown either: Blockly binds its ShortcutRegistry listener to
  // `document`, so its `escape` shortcut sees the key even though this dialog
  // renders in a portal outside the workspace, and consumed it first — the
  // "esc" hint in the search field was telling the user something untrue.
  //
  // `window` in the capture phase is what wins: capture runs outermost-first,
  // so window fires before document, whatever order the listeners registered
  // in. stopPropagation then keeps the same press from also reaching Blockly
  // and cancelling something on the canvas behind the dialog.
  useEffect(() => {
    if (!open) return
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onEscape, true)
    return () => window.removeEventListener('keydown', onEscape, true)
  }, [open, onClose])

  // Step-insertable blocks in toolbox order + published macros (Saved Tasks).
  const items = useMemo(() => buildSequencePickerItems(macros), [macros])
  const filtered = useMemo(
    () => filterShadowItems(items, query),
    [items, query],
  )

  // Query changing reshuffles `filtered` — the previous highlighted index
  // would otherwise point at an unrelated (or out-of-bounds) result.
  useEffect(() => {
    setHighlightedIndex(0)
  }, [query])

  useEffect(() => {
    highlightedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  // Carry each item's flat index through grouping so keyboard nav (which
  // walks the flat, filtered/ranked order) and the grouped display agree on
  // which one is "highlighted".
  const grouped = useMemo(() => {
    const out: Record<string, { item: ShadowPickerItem; index: number }[]> = {}
    filtered.forEach((item, index) => {
      ;(out[item.group ?? 'Other'] ??= []).push({ item, index })
    })
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
      aria-label="Search for a step"
      // MUI restores focus to whatever opened the dialog when it closes, which
      // would immediately undo the focusNode() that insertStepBlockAtEnd puts
      // on the newly inserted block — the user would be dropped back on the
      // canvas with no cursor. ShadowPickerMenu carries this for the same
      // reason.
      disableRestoreFocus
      slotProps={{ paper: { elevation: 0, sx: { ...MENU_PAPER_SX, mt: -10 } } }}
    >
      <DialogContent sx={{ p: 1.5 }}>
        <TextField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a step to add…"
          size="small"
          fullWidth
          autoFocus
          onKeyDown={(e) => {
            if (filtered.length === 0) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHighlightedIndex((i) => (i + 1) % filtered.length)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlightedIndex(
                (i) => (i - 1 + filtered.length) % filtered.length,
              )
            } else if (e.key === 'Enter' && filtered[highlightedIndex]) {
              handleSelect(filtered[highlightedIndex])
            }
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
                {groupItems.map(({ item, index }) => (
                  <ListItemButton
                    key={`${item.group}-${item.id}-${item.name}`}
                    ref={index === highlightedIndex ? highlightedRef : null}
                    selected={index === highlightedIndex}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setHighlightedIndex(index)}
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
