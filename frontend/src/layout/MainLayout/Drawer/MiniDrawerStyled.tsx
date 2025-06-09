import { styled, Theme } from '@mui/material/styles'
import Drawer from '@mui/material/Drawer'

import { drawerWidth } from 'utils/constants'

export const openedMixin = (theme: Theme) => ({
  width: drawerWidth,
  borderRight: `1px solid ${theme.palette.divider}`,
  transition: theme.transitions.create('width', {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.enteringScreen,
  }),
  overflowX: 'hidden' as any,
  boxShadow: 'none',
})

export const closedMixin = (theme: Theme) => ({
  transition: theme.transitions.create('width', {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  overflowX: 'hidden' as any,
  width: 0,
  borderRight: 'none',
  boxShadow: (theme as any).customShadows.z1,
})

interface MiniDrawerStyledProps {
  theme: Theme
  open: boolean
}

export const MiniDrawerStyled = styled(Drawer, {
  shouldForwardProp: (prop) => prop !== 'open',
})((p: MiniDrawerStyledProps) => ({
  width: drawerWidth,
  flexShrink: 0,
  whiteSpace: 'nowrap',
  boxSizing: 'border-box',
  ...(p.open && {
    ...openedMixin(p.theme),
    '& .MuiDrawer-paper': openedMixin(p.theme),
  }),
  ...(!p.open && {
    ...closedMixin(p.theme),
    '& .MuiDrawer-paper': closedMixin(p.theme),
  }),
}))
