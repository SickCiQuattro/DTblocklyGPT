import { Theme } from '@mui/material'

export const Chip = (theme: Theme) => ({
  MuiChip: {
    styleOverrides: {
      root: {
        borderRadius: 4,
        '&:active': {
          boxShadow: 'none',
        },
      },
      sizeLarge: {
        fontSize: '1rem',
        height: 40,
      },
      light: {
        color: theme.palette.primary.main,
        backgroundColor: (theme.palette.primary as any).lighter,
        borderColor: theme.palette.primary.light,
        '&.MuiChip-lightError': {
          color: theme.palette.error.main,
          backgroundColor: (theme.palette.error as any).lighter,
          borderColor: theme.palette.error.light,
        },
        '&.MuiChip-lightSuccess': {
          color: theme.palette.success.main,
          backgroundColor: (theme.palette.success as any).lighter,
          borderColor: theme.palette.success.light,
        },
        '&.MuiChip-lightWarning': {
          color: theme.palette.warning.main,
          backgroundColor: (theme.palette.warning as any).lighter,
          borderColor: theme.palette.warning.light,
        },
      },
    },
  },
})
