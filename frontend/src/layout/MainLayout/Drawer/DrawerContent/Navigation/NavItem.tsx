import React, { forwardRef, RefObject, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { useTheme } from '@mui/material/styles'
import {
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  useMediaQuery,
} from '@mui/material'

import { activeItem, openDrawer } from 'store/reducers/menu'
import { useAppSelector } from 'store/reducers'
import { defaultPath } from 'utils/constants'
import { MenuItem } from 'menu-items/types'

const getListItemProps = (
  external: boolean | undefined,
  url: string | undefined,
  target: '_blank' | '_self'
) => {
  if (external) {
    return { component: 'a', href: url, target }
  }

  const result = {
    component: forwardRef((props, ref) => (
      <Link
        ref={ref as RefObject<HTMLAnchorElement>}
        to={url || defaultPath}
        target={target}
        {...props}
      />
    )),
  }
  result.component.displayName = 'Link'

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

  const itemHandler = (id: string) => {
    dispatch(activeItem(id))
    if (matchDownLG) dispatch(openDrawer(false))
  }

  const Icon = item.icon
  const itemIcon = item.icon ? (
    <Icon style={{ fontSize: drawerOpen ? '1rem' : '1.25rem' }} />
  ) : (
    false
  )

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
    <ListItemButton
      {...listItemProps}
      disabled={item.disabled}
      onClick={() => itemHandler(item.id)}
      selected={isSelected}
      sx={{
        zIndex: 1201,
        pl: drawerOpen ? `${level * 28}px` : 1.5,
        py: !drawerOpen && level === 1 ? 1.25 : 1,
        ...(drawerOpen && {
          '&:hover': {
            bgcolor: 'primary.lighter',
          },
          '&.Mui-selected': {
            bgcolor: 'primary.lighter',
            borderRight: `2px solid ${theme.palette.primary.main}`,
            color: iconSelectedColor,
            '&:hover': {
              color: iconSelectedColor,
              bgcolor: 'primary.lighter',
            },
          },
        }),
        ...(!drawerOpen && {
          '&:hover': {
            bgcolor: 'transparent',
          },
          '&.Mui-selected': {
            '&:hover': {
              bgcolor: 'transparent',
            },
            bgcolor: 'transparent',
          },
        }),
      }}
    >
      {itemIcon && (
        <ListItemIcon
          sx={{
            minWidth: 28,
            color: isSelected ? iconSelectedColor : textColor,
            ...(!drawerOpen && {
              borderRadius: 1.5,
              width: 36,
              height: 36,
              alignItems: 'center',
              justifyContent: 'center',
              '&:hover': {
                bgcolor: 'secondary.lighter',
              },
            }),
            ...(!drawerOpen &&
              isSelected && {
                bgcolor: 'primary.lighter',
                '&:hover': {
                  bgcolor: 'primary.lighter',
                },
              }),
          }}
        >
          {itemIcon}
        </ListItemIcon>
      )}
      {(drawerOpen || (!drawerOpen && level !== 1)) && (
        <ListItemText
          primary={
            <Typography
              variant="h6"
              sx={{ color: isSelected ? iconSelectedColor : textColor }}
            >
              {item.title}
            </Typography>
          }
        />
      )}
    </ListItemButton>
  )
}
