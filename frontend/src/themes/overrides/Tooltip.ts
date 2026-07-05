import { Theme } from '@mui/material'

export const Tooltip = (theme: Theme) => ({
  MuiTooltip: {
    styleOverrides: {
      tooltip: {
        backgroundColor: theme.palette.slate[800],
        fontSize: '0.75rem',
        borderRadius: 6,
      },
    },
  },
})
