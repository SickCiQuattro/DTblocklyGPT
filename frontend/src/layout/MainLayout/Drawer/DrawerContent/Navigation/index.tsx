import React from 'react'
import { Box, Typography } from '@mui/material'

import { getMenuItems } from 'menu-items'
import { NavGroup } from './NavGroup'

export const Navigation = () => {
  const menuItems = getMenuItems()
  const navGroups = menuItems.map((item) => {
    switch (item.type) {
      case 'group':
        return <NavGroup key={item.id} item={item} />
      default:
        return (
          <Typography key={item.id} variant="h6" color="error" align="center">
            Fix - Navigation Group
          </Typography>
        )
    }
  })

  return <Box sx={{ pt: 2 }}>{navGroups}</Box>
}
