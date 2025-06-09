import React, { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useDispatch } from 'react-redux'
// import { useTheme } from '@mui/material/styles'
import { Box, Toolbar /* useMediaQuery */ } from '@mui/material'

import { useAppSelector } from 'store/reducers'
import { openDrawer } from 'store/reducers/menu'
import { MainDrawer } from './Drawer'
import { Header } from './Header'

export const MainLayout = () => {
  // const theme = useTheme()
  // const matchDownXL = useMediaQuery(theme.breakpoints.down('xl'))
  const dispatch = useDispatch()

  const drawerOpen = useAppSelector((state) => state.menu.drawerOpen)

  // drawer toggler
  const [open, setOpen] = useState(drawerOpen)
  const handleDrawerToggle = () => {
    setOpen(!open)
    dispatch(openDrawer(!open))
  }

  // set media wise responsive drawer
  /*   useEffect(() => {
    setOpen(!matchDownXL)
    dispatch(openDrawer(!matchDownXL))
  }, [matchDownXL, dispatch]) */

  useEffect(() => {
    if (open !== drawerOpen) setOpen(drawerOpen)
  }, [drawerOpen, open])

  return (
    <Box sx={{ display: 'flex', width: '100%' }}>
      <Header open={open} handleDrawerToggle={handleDrawerToggle} />
      <MainDrawer open={open} handleDrawerToggle={handleDrawerToggle} />
      <Box
        component="main"
        sx={{ width: '100%', flexGrow: 1, p: { xs: 2, sm: 3 } }}
      >
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  )
}
