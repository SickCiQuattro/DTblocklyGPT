import { List } from '@mui/material'

import { useAppSelector } from 'store/reducers'
import { MenuItem } from 'menu-items/types'

import { NavItem } from './NavItem'
import { NavGroupHeader } from './NavGroupHeader'

interface NavGroupProps {
  item: MenuItem
}

export const NavGroup = ({ item }: NavGroupProps) => {
  const drawerOpen = useAppSelector((state) => state.menu.drawerOpen)

  // A group's children are always leaf 'item' entries — nested groups aren't
  // part of the menu data today.
  const navCollapse = item.children
    ?.filter((menuItem) => menuItem.type === 'item')
    .map((menuItem) => <NavItem key={menuItem.id} item={menuItem} level={1} />)

  return (
    <>
      <NavGroupHeader title={item.title} drawerOpen={drawerOpen} />
      <List sx={{ py: 0, mb: 0.5, zIndex: 0 }}>{navCollapse}</List>
    </>
  )
}
