import { Theme } from '@mui/material'

export const InputLabel = (theme: Theme) => ({
  MuiInputLabel: {
    styleOverrides: {
      root: {
        color: theme.palette.grey[600],
      },
      outlined: {
        lineHeight: '0.8em',
        '&.MuiInputLabel-sizeSmall': {
          lineHeight: '1em',
        },
        '&.MuiInputLabel-shrink': {
          background: 'transparent',
          padding: '0 8px',
          marginLeft: -6,
          lineHeight: '1.4375em',
        },
      },
    },
  },
})
