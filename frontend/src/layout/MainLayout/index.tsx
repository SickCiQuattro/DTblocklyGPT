import React from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { useTheme } from '@mui/material/styles'
import { Box, Toolbar, useMediaQuery } from '@mui/material'

import { useAppSelector } from 'store/reducers'
import { openDrawer } from 'store/reducers/menu'

import { MainDrawer } from './Drawer'
import { Header } from './Header'

export const MainLayout = () => {
  const theme = useTheme()
  const matchDownLG = useMediaQuery(theme.breakpoints.down('lg'))
  const dispatch = useDispatch()
  const location = useLocation()

  const drawerOpen = useAppSelector((state) => state.menu.drawerOpen)
  const isIDERoute = location.pathname.startsWith('/task/')
  const showHeader = isIDERoute || matchDownLG

  // drawer toggler
  const handleDrawerToggle = () => {
    dispatch(openDrawer(!drawerOpen))
  }

  return (
    <Box
      sx={{
        display: 'flex',
        width: '100%',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      <Box
        component="a"
        href="#main-content"
        sx={{
          position: 'absolute',
          left: '8px',
          top: '-48px',
          zIndex: 2000,
          padding: '8px 14px',
          borderRadius: '8px',
          background: 'primary.dark',
          color: 'common.white',
          fontSize: '13px',
          fontWeight: 600,
          textDecoration: 'none',
          transition: 'top 0.15s ease',
          '&:focus': {
            top: '8px',
            outline: '2px solid #fff',
            outlineOffset: '2px',
          },
        }}
      >
        Skip to main content
      </Box>
      {showHeader && (
        <Header open={drawerOpen} handleDrawerToggle={handleDrawerToggle} />
      )}
      <MainDrawer open={drawerOpen} handleDrawerToggle={handleDrawerToggle} />
      <Box
        component="main"
        id="main-content"
        sx={{
          width: '100%',
          flexGrow: 1,
          p: isIDERoute ? 0 : { xs: 2, sm: 3 },
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: isIDERoute ? 'hidden' : 'auto',
        }}
      >
        {showHeader && <Toolbar />}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: isIDERoute ? 'hidden' : 'auto',
          }}
        >
          <Outlet />
        </Box>
      </Box>
    </Box>
  )
}
