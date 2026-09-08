import { useMemo } from 'react'
import { useTheme } from '@mui/material/styles'
import { Box, Divider, Drawer, useMediaQuery } from '@mui/material'

import { drawerWidth } from 'utils/constants'
import { Profile } from 'layout/MainLayout/Header/Profile'

import { DrawerHeader } from './DrawerHeader'
import { DrawerContent } from './DrawerContent'
import { NAV_SEPARATOR_HEIGHT } from './DrawerContent/Navigation/NavItem'
import {
  closedMixin,
  closedPaperMixin,
  openedMixin,
  openedPaperMixin,
} from './MiniDrawerStyled'

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
  const drawerHeader = useMemo(
    () => <DrawerHeader open={open} handleDrawerToggle={handleDrawerToggle} />,
    [open, handleDrawerToggle],
  )

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
              '& .MuiDrawer-paper': openedPaperMixin(theme),
            }),
            ...(!open && {
              ...closedMixin(theme),
              '& .MuiDrawer-paper': closedPaperMixin(theme),
            }),
          }}
        >
          {drawerHeader}
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {drawerContent}
          </Box>
          <Box
            onClick={(e) => e.stopPropagation()}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              bgcolor: 'background.paper',
            }}
          >
            {/* Same fixed-height separator as the FAQ row above — reserving
                the height in both states is what keeps the profile from
                shifting when the rail is toggled. */}
            <Box
              aria-hidden
              sx={{
                height: NAV_SEPARATOR_HEIGHT,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Divider
                sx={{ width: open ? '100%' : 24, borderColor: 'divider' }}
              />
            </Box>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: open ? 'flex-start' : 'center',
                width: '100%',
                // Less on top than underneath, and the difference is the
                // separator.
                //
                // The rule above this block sits at the vertical CENTRE of its
                // own 17px row, so half that row — about 8px — already counts
                // as space between the line and this box. Equal padding on both
                // sides therefore renders unequal: 20px above the avatar
                // against 12 below, which is what read as badly framed.
                //
                // 8/12 puts the visible gaps at roughly 16 and 12; the rail's
                // own rounded bottom edge accounts for the rest, and these are
                // tuned to what renders rather than to what the box model
                // predicts.
                padding: '8px 8px 12px',
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
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
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
