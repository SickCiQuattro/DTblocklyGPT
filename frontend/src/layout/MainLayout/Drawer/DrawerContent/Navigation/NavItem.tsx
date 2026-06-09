import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { useTheme } from '@mui/material/styles'
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
  const itemIcon = Icon ? <Icon style={{ fontSize: '1.15rem' }} /> : false

  const currentIndex = document.location.pathname
    .toString()
    .split('/')
    .findIndex((id) => id === item.id)

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
        sx={{
          zIndex: 1201,
          borderRadius: '8px',
          mx: 1,
          my: 0.25,
          px: 1,
          py: 1,
          display: 'flex',
          justifyContent: 'flex-start',
          alignItems: 'center',
          position: 'relative',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            bgcolor: 'rgba(99, 102, 241, 0.04)',
          },
          '&.Mui-selected': {
            bgcolor: 'rgba(99, 102, 241, 0.08)',
            color: iconSelectedColor,
            '&:hover': {
              bgcolor: 'rgba(99, 102, 241, 0.08)',
            },
            // Sleek left-accent indicator bar (Design System)
            '&::before': {
              content: '""',
              position: 'absolute',
              left: 0,
              top: '8px',
              bottom: '8px',
              width: '3px',
              borderRadius: '0 4px 4px 0',
              bgcolor: theme.palette.primary.main,
            },
          },
        }}
      >
        {itemIcon && (
          <ListItemIcon
            sx={{
              minWidth: '24px',
              mr: drawerOpen ? '12px' : '0px',
              color: isSelected ? iconSelectedColor : textColor,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              transition: 'margin-right 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            {itemIcon}
          </ListItemIcon>
        )}
        <ListItemText
          sx={{
            margin: 0,
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
