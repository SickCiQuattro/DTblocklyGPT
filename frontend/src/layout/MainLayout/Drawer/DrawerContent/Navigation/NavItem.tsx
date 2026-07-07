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

// Shared rail metric — every row (nav items + FAQ) is the same height, and the
// icon lives in a fixed-width column whose left edge is the same in both states,
// so the glyph centers on the 56px rail when collapsed and stays put when open.
export const NAV_ROW_HEIGHT = 44
export const ICON_COLUMN = 28

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

  const currentIndex = document.location.pathname
    .toString()
    .split('/')
    .findIndex((id) => id === item.id)

  // The task workspace lives at /task/:id (singular), which never matches the
  // "tasks" nav item by path segment — without this, opening a task leaves
  // the rail showing nothing active, even though the task workspace is
  // conceptually still "under" Tasks.
  const isTasksItemInWorkspace =
    item.id === 'tasks' && document.location.pathname.startsWith('/task/')

  const isSelected =
    currentIndex > -1 || openItem === item.id || isTasksItemInWorkspace

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
            transition:
              'opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), max-width 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
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
