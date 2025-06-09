import React from 'react'
import { useTheme } from '@mui/material/styles'
import { IconButton, Toolbar, useMediaQuery } from '@mui/material'
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons'
import AppBar from '@mui/material/AppBar'

import { Profile } from 'layout/MainLayout/Header/Profile'
import { drawerWidth } from 'utils/constants'

interface HeaderProps {
  open: boolean
  handleDrawerToggle: () => void
}

export const Header = ({ open, handleDrawerToggle }: HeaderProps) => {
  const theme = useTheme()
  const matchDownLG = useMediaQuery(theme.breakpoints.down('lg'))

  const iconBackColor = 'grey.100'
  const iconBackColorOpen = 'grey.200'

  const mainHeader = (
    <Toolbar sx={{ justifyContent: 'space-between' }}>
      <IconButton
        disableRipple
        aria-label="open drawer"
        onClick={handleDrawerToggle}
        edge="start"
        color="secondary"
        sx={{
          color: 'text.primary',
          bgcolor: open ? iconBackColorOpen : iconBackColor,
          ml: { xs: 0, lg: -2 },
        }}
      >
        {!open ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
      </IconButton>
      <Profile />
    </Toolbar>
  )

  const appBarStyle = {
    position: 'fixed' as any,
    color: 'inherit' as any,
    elevation: 0,
    sx: {
      borderBottom: `1px solid ${theme.palette.divider}`,
    },
  }

  return !matchDownLG ? (
    <AppBar
      position={appBarStyle.position}
      color={appBarStyle.color}
      elevation={appBarStyle.elevation}
      sx={{
        borderBottom: appBarStyle.sx.borderBottom,
        zIndex: theme.zIndex.drawer + 1,
        transition: theme.transitions.create(['width', 'margin'], {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.leavingScreen,
        }),
        ...(open && {
          marginLeft: drawerWidth,
          width: `calc(100% - ${drawerWidth}px)`,
          transition: theme.transitions.create(['width', 'margin'], {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.enteringScreen,
          }),
        }),
      }}
    >
      {mainHeader}
    </AppBar>
  ) : (
    <AppBar
      position={appBarStyle.position}
      color={appBarStyle.color}
      elevation={appBarStyle.elevation}
      sx={appBarStyle.sx}
    >
      {mainHeader}
    </AppBar>
  )
}
