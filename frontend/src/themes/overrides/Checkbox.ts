import { Theme } from '@mui/material'

export const Checkbox = (theme: Theme) => ({
  MuiCheckbox: {
    styleOverrides: {
      root: {
        color: theme.palette.secondary[300],
      },
    },
  },
  MuiSvgIcon: {
    styleOverrides: {
      root: {
        background: 'white',
      },
    },
  },
})
