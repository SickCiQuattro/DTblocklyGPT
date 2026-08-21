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

  // Move focus into the new page on navigation. A single-page app swaps the
  // DOM without the focus reset a real page load gives you: focus is left on
  // whatever was clicked (or on <body> if that element is gone), so a keyboard
  // user Tabs from the old position and a screen reader announces nothing.
  // The page title is already updated per route by useDocumentTitle, which
  // covers 2.4.2; this covers the focus half.
  const mainRef = React.useRef<HTMLElement | null>(null)
  const isFirstRenderRef = React.useRef(true)
  React.useEffect(() => {
    // Not on first paint: there the browser's own initial focus is correct,
    // and stealing it would skip past the skip link.
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      return
    }
    mainRef.current?.focus()
  }, [location.pathname])

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
          // backgroundColor, NOT background: MUI's sx resolves palette paths
          // for `color`, `bgcolor` and `backgroundColor` only. Written as
          // `background` the string reached the CSS verbatim, was invalid, and
          // was dropped — leaving white text on a white page, so the link
          // appeared as an empty box and could not be read.
          backgroundColor: 'primary.dark',
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
        ref={mainRef}
        // <main> is not focusable on its own, so without this the skip link
        // above only scrolls the viewport: focus stays where it was and the
        // next Tab resumes from the header, which is what the link exists to
        // skip. -1 keeps it out of the tab sequence while making it a valid
        // target for programmatic focus (the skip link, and the route-change
        // focus reset below). Same pattern as #blocklyDiv.
        tabIndex={-1}
        sx={{
          width: '100%',
          // A focus ring on a whole page region is noise: it is focused only as
          // a landing spot, never as a control.
          outline: 'none',
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
