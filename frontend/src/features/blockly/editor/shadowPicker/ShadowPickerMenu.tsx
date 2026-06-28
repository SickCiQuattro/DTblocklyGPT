/**
 * shadowPicker/ShadowPickerMenu.tsx
 *
 * Pure presentation component for the shadow-block picker floating menu.
 *
 * All business logic (item computation, search filtering, block creation) lives
 * in `useShadowPicker`. This component only receives the already-computed data
 * as props and renders the MUI `<Menu>` with:
 *  - A sticky search field at the top
 *  - Items grouped by their `group` label with section dividers
 *  - A coloured dot indicator per group
 *  - An optional `paramHint` badge next to the item name
 *  - Empty-state copy when no items match the query
 */

import {
  alpha,
  Box,
  Divider,
  InputBase,
  Menu,
  MenuItem,
  ListItemText,
  Typography,
  useTheme,
} from '@mui/material'
import { Search } from 'lucide-react'

import { MENU_PAPER_SX } from '../menuStyles'

import {
  type ShadowPickerItem,
  type ShadowPickerPosition,
  type ShadowPopoverType,
  SHADOW_PICKER_TITLE_BY_TYPE,
  SHADOW_PICKER_EMPTY_BY_TYPE,
} from './types'
import { getDotColour } from './catalog'

// ─── PROPS ────────────────────────────────────────────────────────────────────

interface ShadowPickerMenuProps {
  /** Whether the MUI Menu is currently open. */
  isOpen: boolean
  /** Anchor coordinates for the Menu popover. */
  position: ShadowPickerPosition | null
  /** Semantic context of the slot being filled (drives title and empty-state copy). */
  popoverType: ShadowPopoverType | null
  /** Items filtered by the current search query, pre-grouped by section label. */
  groupedItems: Record<string, ShadowPickerItem[]>
  /** Items filtered by the current search query (flat list, used for empty check). */
  filteredItems: ShadowPickerItem[]
  /** Current value of the search input. */
  searchQuery: string
  /** Called when the user types in the search input. */
  onSearchChange: (query: string) => void
  /** Called when the user selects an item from the menu. */
  onSelect: (item: ShadowPickerItem) => void
  /** Called when the menu should close (click outside, Escape key, etc.). */
  onClose: () => void
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

/**
 * Floating menu anchored at the screen position of the clicked shadow block.
 * Renders a searchable, grouped list of block options for the user to choose from.
 */
export const ShadowPickerMenu = ({
  isOpen,
  position,
  popoverType,
  groupedItems,
  filteredItems,
  searchQuery,
  onSearchChange,
  onSelect,
  onClose,
}: ShadowPickerMenuProps) => {
  const theme = useTheme()
  return (
    <Menu
      open={isOpen}
      onClose={onClose}
      autoFocus={false}
      disableAutoFocusItem
      anchorReference="anchorPosition"
      anchorPosition={position ?? undefined}
      transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      slotProps={{
        paper: {
          elevation: 0,
          sx: {
            ...MENU_PAPER_SX,
            mt: 1,
            minWidth: 280,
            maxWidth: 380,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          },
        },
        list: {
          dense: true,
          sx: { p: 0 },
        },
      }}
    >
      {/* ── Sticky header: title + search field ── */}
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          backgroundColor: theme.palette.background.paper,
          zIndex: 1,
          px: 1.25,
          pt: 1.25,
          pb: 1,
        }}
      >
        <Typography
          variant="subtitle2"
          sx={{
            fontWeight: 700,
            color: theme.palette.slate[900],
            fontSize: '0.85rem',
            mb: 1,
          }}
        >
          {popoverType ? SHADOW_PICKER_TITLE_BY_TYPE[popoverType] : 'Select'}
        </Typography>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: theme.palette.background.paper,
            borderRadius: '8px',
            border: `1px solid ${theme.palette.slate[200]}`,
            px: 1,
            py: 0.5,
            transition: 'border-color 0.18s ease, box-shadow 0.18s ease',
            '&:focus-within': {
              borderColor: theme.palette.info.main,
              boxShadow: `0 0 0 2px ${alpha(theme.palette.info.main, 0.15)}`,
            },
          }}
        >
          <Search
            size={16}
            color={theme.palette.slate[500]}
            style={{ marginRight: 8 }}
          />
          <InputBase
            autoFocus
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(event) => {
              // Prevent the MUI MenuList typeahead from hijacking keyboard input
              // while the user is typing in the search box.
              event.stopPropagation()
            }}
            sx={{
              flex: 1,
              fontSize: '0.85rem',
              fontWeight: 500,
              color: theme.palette.slate[800],
              '& input::placeholder': {
                color: theme.palette.slate[400],
                opacity: 1,
              },
            }}
          />
        </Box>
      </Box>

      <Divider sx={{ mx: 0, borderColor: theme.palette.slate[200] }} />

      {/* ── Scrollable item list ── */}
      <Box
        sx={{
          maxHeight: 280,
          overflowY: 'auto',
          px: 1,
          py: 0.75,
          '&::-webkit-scrollbar': { width: '6px' },
          '&::-webkit-scrollbar-track': {
            backgroundColor: theme.palette.slate[50],
            borderRadius: '10px',
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: theme.palette.slate[300],
            borderRadius: '10px',
          },
          '&::-webkit-scrollbar-thumb:hover': {
            backgroundColor: theme.palette.slate[400],
          },
        }}
      >
        {filteredItems.length === 0 ? (
          /* Empty state */
          <MenuItem disabled sx={{ borderRadius: 1.5 }}>
            <ListItemText
              primary={
                searchQuery
                  ? 'No results found.'
                  : popoverType
                    ? SHADOW_PICKER_EMPTY_BY_TYPE[popoverType]
                    : 'No items.'
              }
              slotProps={{
                primary: {
                  sx: { fontSize: '0.85rem', textAlign: 'center', py: 2 },
                },
              }}
            />
          </MenuItem>
        ) : (
          /* Grouped item rows */
          Object.entries(groupedItems).map(([group, items], groupIdx) => (
            <Box key={group}>
              {groupIdx > 0 && (
                <Divider
                  sx={{ my: 0.5, borderColor: theme.palette.slate[200] }}
                />
              )}

              {/* Section header */}
              <Typography
                sx={{
                  px: 1.25,
                  py: 0.5,
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: theme.palette.slate[400],
                  textTransform: 'uppercase',
                }}
              >
                {group}
              </Typography>

              {items.map((item) => (
                <MenuItem
                  key={`${popoverType}-${item.id}`}
                  onClick={() => onSelect(item)}
                  sx={{
                    my: 0.15,
                    minHeight: 52,
                    borderRadius: '8px',
                    px: 1.25,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1,
                    '&:hover': {
                      backgroundColor: theme.palette.slate[50],
                    },
                  }}
                >
                  {/* Coloured dot indicating the group / category */}
                  <Box
                    sx={{
                      mt: '5px',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      flexShrink: 0,
                      backgroundColor: getDotColour(group),
                    }}
                  />

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    {/* Name row with optional paramHint badge */}
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                      }}
                    >
                      <Typography
                        sx={{
                          fontSize: '0.85rem',
                          fontWeight: 600,
                          color: theme.palette.slate[900],
                        }}
                      >
                        {item.name}
                      </Typography>
                      {item.paramHint && (
                        <Box
                          sx={{
                            px: 0.75,
                            py: 0.1,
                            borderRadius: '4px',
                            backgroundColor: theme.palette.slate[100],
                            border: `1px solid ${theme.palette.slate[200]}`,
                            fontSize: '0.7rem',
                            fontWeight: 500,
                            color: theme.palette.slate[500],
                            flexShrink: 0,
                          }}
                        >
                          {item.paramHint}
                        </Box>
                      )}
                    </Box>

                    {/* Description (preferred) or keyword fallback */}
                    {item.description && (
                      <Typography
                        sx={{
                          mt: 0.2,
                          fontSize: '1rem',
                          color: theme.palette.slate[500],
                          lineHeight: 1.4,
                        }}
                      >
                        {item.description}
                      </Typography>
                    )}

                    {item.keywords.length > 0 && !item.description && (
                      <Typography
                        sx={{
                          mt: 0.2,
                          fontSize: '1rem',
                          color: theme.palette.slate[500],
                        }}
                      >
                        Keywords: {item.keywords.join(', ')}
                      </Typography>
                    )}
                  </Box>
                </MenuItem>
              ))}
            </Box>
          ))
        )}
      </Box>
    </Menu>
  )
}
