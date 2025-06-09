import { Theme } from '@mui/material'

export const Tab = (theme: Theme) => ({
  MuiTab: {
    styleOverrides: {
      root: {
        minHeight: 46,
        color: theme.palette.text.primary,
      },
    },
  },
})
