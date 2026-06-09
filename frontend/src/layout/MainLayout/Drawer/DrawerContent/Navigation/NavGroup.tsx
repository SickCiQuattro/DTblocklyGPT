import React from 'react'
import { Box, List, Typography, Divider } from '@mui/material'

import { useAppSelector } from 'store/reducers'
import { MenuItem } from 'menu-items/types'

import { NavItem } from './NavItem'

interface NavGroupProps {
  item: MenuItem
}

export const NavGroup = ({ item }: NavGroupProps) => {
  const drawerOpen = useAppSelector((state) => state.menu.drawerOpen)

  const navCollapse = item.children?.map((menuItem) => {
    switch (menuItem.type) {
      case 'item':
        return <NavItem key={menuItem.id} item={menuItem} level={1} />
      default:
        return (
          <Typography
            key={menuItem.id}
            variant="h6"
            color="error"
            align="center"
          >
            Fix - Group Collapse or Items
          </Typography>
        )
    }
  })

  return (
    <>
      {!drawerOpen && item.id !== 'define' && (
        <Divider sx={{ my: 1, mx: 1.5, borderColor: 'rgba(0, 0, 0, 0.06)' }} />
      )}
      <List
        subheader={
          item.title &&
          drawerOpen && (
            <Box sx={{ pl: 3, mb: 1.5 }}>
              <Typography variant="subtitle2" color="textSecondary">
                {item.title}
              </Typography>
            </Box>
          )
        }
        sx={{ mb: drawerOpen ? 1.5 : 0, py: 0, zIndex: 0 }}
      >
        {navCollapse}
      </List>
    </>
  )
}
