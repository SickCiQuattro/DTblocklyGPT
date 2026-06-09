import React, { useMemo } from 'react'
import { useTheme } from '@mui/material/styles'
import { Box, Drawer, useMediaQuery, IconButton, Tooltip } from '@mui/material'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { drawerWidth } from 'utils/constants'
import { Profile } from 'layout/MainLayout/Header/Profile'

import { DrawerHeader } from './DrawerHeader'
import { DrawerContent } from './DrawerContent'
import { closedMixin, openedMixin } from './MiniDrawerStyled'

interface MainDrawerProps {
  open: boolean
  handleDrawerToggle: () => void
}

export const MainDrawer = ({ open, handleDrawerToggle }: MainDrawerProps) => {
  const theme = useTheme()
  const matchDownLG = useMediaQuery(theme.breakpoints.down('lg'))

  // responsive drawer container
  const container = window !== undefined ? window.document.body : undefined

  // header content
  const drawerContent = useMemo(() => <DrawerContent open={open} />, [open])
  const drawerHeader = useMemo(() => <DrawerHeader open={open} handleDrawerToggle={handleDrawerToggle} />, [open, handleDrawerToggle])

  return (
    <Box component="nav" sx={{ flexShrink: { md: 0 }, zIndex: 1100 }}>
      {!matchDownLG ? (
        <Drawer
          variant="permanent"
          open={open}
          onClick={!open ? handleDrawerToggle : undefined}
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            whiteSpace: 'nowrap',
            boxSizing: 'border-box',
            cursor: !open ? 'pointer' : 'default',
            ...(open && {
              ...openedMixin(theme),
              '& .MuiDrawer-paper': openedMixin(theme),
            }),
            ...(!open && {
              ...closedMixin(theme),
              '& .MuiDrawer-paper': closedMixin(theme),
            }),
          }}
        >
          {drawerHeader}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {drawerContent}
          </Box>
          <Box
            onClick={(e) => {
              if (open) e.stopPropagation()
            }}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5,
              padding: '12px 8px',
              borderTop: `1px solid ${theme.palette.divider}`,
              bgcolor: 'background.paper',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                width: '100%',
              }}
            >
              <Profile drawerOpen={open} />
            </Box>
          </Box>
        </Drawer>
      ) : (
        <Drawer
          container={container}
          variant="temporary"
          open={open}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', lg: 'none' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
              borderRight: `1px solid ${theme.palette.divider}`,
              backgroundImage: 'none',
              boxShadow: 'inherit',
            },
          }}
        >
          {open && drawerHeader}
          {open && (
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {drawerContent}
            </Box>
          )}
          {open && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
                padding: '12px',
                borderTop: `1px solid ${theme.palette.divider}`,
                bgcolor: 'background.paper',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                }}
              >
                <Profile drawerOpen={true} />
              </Box>
            </Box>
          )}
        </Drawer>
      )}
    </Box>
  )
}
