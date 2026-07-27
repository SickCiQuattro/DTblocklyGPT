import React from 'react'
import { Box } from '@mui/material'

import { getMenuItems } from 'menu-items'

import { NavGroup } from './NavGroup'

export const Navigation = () => {
  const menuItems = getMenuItems()
  // getMenuItems() only ever returns top-level 'group' entries — 'item' is
  // for nested children within a group's own `children` array.
  const navGroups = menuItems
    .filter((item) => item.type === 'group')
    .map((item) => <NavGroup key={item.id} item={item} />)

  return <Box sx={{ pt: 2 }}>{navGroups}</Box>
}
