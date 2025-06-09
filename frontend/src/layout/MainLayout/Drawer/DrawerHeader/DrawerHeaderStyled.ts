import { styled } from '@mui/material/styles'
import { Box, Theme } from '@mui/material'

interface DrawerHeaderStyledProps {
  theme: Theme
  open: boolean
}

export const DrawerHeaderStyled = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'open',
})((p: DrawerHeaderStyledProps) => ({
  ...p.theme.mixins.toolbar,
  display: 'flex',
  alignItems: 'center',
  justifyContent: p.open ? 'flex-start' : 'center',
  paddingLeft: p.theme.spacing(p.open ? 3 : 0),
}))
