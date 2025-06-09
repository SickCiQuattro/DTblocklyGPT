import { styled, Theme } from '@mui/material/styles'
import AppBar from '@mui/material/AppBar'

import { drawerWidth } from 'utils/constants'

interface AppBarStyledProps {
  open: boolean
  theme: Theme
}

export const AppBarStyled = styled(AppBar, {
  shouldForwardProp: (prop) => prop !== 'open',
})((p: AppBarStyledProps) => ({
  zIndex: p.theme.zIndex.drawer + 1,
  transition: p.theme.transitions.create(['width', 'margin'], {
    easing: p.theme.transitions.easing.sharp,
    duration: p.theme.transitions.duration.leavingScreen,
  }),
  ...(p.open && {
    marginLeft: drawerWidth,
    width: `calc(100% - ${drawerWidth}px)`,
    transition: p.theme.transitions.create(['width', 'margin'], {
      easing: p.theme.transitions.easing.sharp,
      duration: p.theme.transitions.duration.enteringScreen,
    }),
  }),
}))
