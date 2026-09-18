import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { useTheme, alpha } from '@mui/material/styles'
import {
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  useMediaQuery,
  Tooltip,
} from '@mui/material'

import { activeItem, openDrawer } from 'store/reducers/menu'
import { useAppSelector } from 'store/reducers'
import { defaultPath } from 'utils/constants'
import { MenuItem } from 'menu-items/types'

import { railTransition } from '../../MiniDrawerStyled'

// Shared rail metric — every row (nav items + FAQ) is the same height, and the
// icon lives in a fixed-width column whose left edge is the same in both states,
// so the glyph centers on the 56px rail when collapsed and stays put when open.
export const NAV_ROW_HEIGHT = 44
export const ICON_COLUMN = 28

// Height reserved for a footer separator row (hairline + breathing room). The
// row keeps this height in BOTH states — same rule as NAV_GROUP_HEADER_HEIGHT —
// so toggling the rail never shifts the row underneath it.
export const NAV_SEPARATOR_HEIGHT = 17

const getListItemProps = (
  external: boolean | undefined,
  url: string | undefined,
  target: '_blank' | '_self',
) => {
  if (external) {
    return { component: 'a', href: url, target }
  }

  const result = {
    component: Link,
    to: url || defaultPath,
    target,
  }

  return result
}

interface NavItemProps {
  item: MenuItem
  level: number
}

export const NavItem = ({ item, level }: NavItemProps) => {
  const theme = useTheme()
  const primary = theme.palette.primary.main
  const dispatch = useDispatch()
  const { drawerOpen, openItem } = useAppSelector((state) => state.menu)
  const matchDownLG = useMediaQuery(theme.breakpoints.down('lg'))
  const itemTarget = item.target ? '_blank' : '_self'
  const listItemProps = getListItemProps(item.external, item.url, itemTarget)

  const itemHandler = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    dispatch(activeItem(id))
    if (matchDownLG) dispatch(openDrawer(false))
  }

  const Icon = item.icon
  const itemIcon = Icon ? <Icon size={18} /> : false

  // A nav item's id is its LIST route and is plural (`objects`); the matching
  // detail route is singular (`object/:id`). Match either, for every item.
  //
  // This was a special case for `tasks` alone — `/task/:id` never matched the
  // "tasks" id by segment — and the identical gap was open for objects,
  // locations, actions, myrobots, users and robots: six of the seven items
  // that have a detail route, where opening a row left the rail with nothing
  // highlighted at all. That is the screen where the marker matters most,
  // because the page title there is a record's name, not the section's, so
  // the rail was the only thing left saying where you were.
  //
  // Vestigial as of this change, and deliberately not removed here: the seven
  // list pages each call `dispatch(activeItem(''))` before navigating into a
  // detail page (`listObjects.tsx` and its six siblings) — someone read the
  // blank rail as intended and built the other half of it, with the detail
  // page's `backFunction` restoring the id on the way out. They are harmless
  // now: this matches on the path, so `openItem` being '' changes nothing and
  // the effect below writes the right id back on the next render. They are
  // also the only thing in the tree still asserting the old behaviour, so if
  // this ever regresses, start there.
  const singularId = item.id.endsWith('s') ? item.id.slice(0, -1) : null
  const currentIndex = document.location.pathname
    .split('/')
    .findIndex((segment) => segment === item.id || segment === singularId)

  const isSelected = currentIndex > -1 || openItem === item.id

  // active menu item on page load
  useEffect(() => {
    if (currentIndex > -1) {
      dispatch(activeItem(item.id))
    }
  }, [openItem, currentIndex, dispatch, item.id])

  const textColor = 'text.primary'
  const iconSelectedColor = 'primary.main'

  return (
    <Tooltip
      title={item.title}
      placement="right"
      disableHoverListener={drawerOpen}
    >
      <ListItemButton
        {...listItemProps}
        disabled={item.disabled}
        onClick={(e) => itemHandler(item.id, e)}
        selected={isSelected}
        // `selected` only drives the colours. Without aria-current a screen
        // reader hears an ordinary link and gets no indication of where in the
        // app it already is.
        aria-current={isSelected ? 'page' : undefined}
        sx={{
          zIndex: 1201,
          minHeight: NAV_ROW_HEIGHT,
          borderRadius: '8px',
          mx: 1,
          my: 0.25,
          // Fixed left padding (6px) places the 28px icon column at 14px from the
          // rail edge → glyph centered on the 56px rail. Identical in both states.
          pl: '6px',
          pr: 1,
          py: 0,
          display: 'flex',
          justifyContent: 'flex-start',
          alignItems: 'center',
          position: 'relative',
          transition: 'background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            bgcolor: alpha(primary, 0.04),
          },
          '&.Mui-selected': {
            bgcolor: alpha(primary, 0.08),
            color: iconSelectedColor,
            '&:hover': {
              bgcolor: alpha(primary, 0.08),
            },
            // Left-accent bar only in expanded mode; collapsed uses the pill alone.
            ...(drawerOpen && {
              '&::before': {
                content: '""',
                position: 'absolute',
                left: 0,
                top: '8px',
                bottom: '8px',
                width: '3px',
                borderRadius: '0 4px 4px 0',
                bgcolor: primary,
              },
            }),
          },
        }}
      >
        {itemIcon && (
          <ListItemIcon
            sx={{
              minWidth: ICON_COLUMN,
              width: ICON_COLUMN,
              flexShrink: 0,
              color: isSelected ? iconSelectedColor : textColor,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {itemIcon}
          </ListItemIcon>
        )}
        <ListItemText
          sx={{
            margin: 0,
            ml: drawerOpen ? '8px' : 0,
            opacity: drawerOpen ? 1 : 0,
            maxWidth: drawerOpen ? '150px' : '0px',
            minWidth: 0,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            // Must share the rail's own duration/easing: at 200ms the label
            // reached full width while the 300ms rail was still narrow, so
            // mid-transition the row was wider than its container and the
            // scroll area flashed a horizontal scrollbar under the longest
            // label. Growing in lockstep with the rail keeps it contained.
            transition: railTransition(theme, ['opacity', 'max-width']),
          }}
          primary={
            <Typography
              variant="body2"
              sx={{
                color: isSelected ? iconSelectedColor : textColor,
                fontWeight: 500,
              }}
            >
              {item.title}
            </Typography>
          }
        />
      </ListItemButton>
    </Tooltip>
  )
}
