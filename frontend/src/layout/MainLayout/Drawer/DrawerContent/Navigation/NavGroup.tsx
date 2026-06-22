import { List, Typography } from '@mui/material'

import { useAppSelector } from 'store/reducers'
import { MenuItem } from 'menu-items/types'

import { NavItem } from './NavItem'
import { NavGroupHeader } from './NavGroupHeader'

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
      <NavGroupHeader title={item.title} drawerOpen={drawerOpen} />
      <List sx={{ py: 0, mb: 0.5, zIndex: 0 }}>{navCollapse}</List>
    </>
  )
}
