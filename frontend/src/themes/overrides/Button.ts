import { Theme } from '@mui/material'

export const Button = (theme: Theme) => {
  const disabledStyle = {
    '&.Mui-disabled': {
      backgroundColor: theme.palette.grey[200],
    },
  }

  return {
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          fontWeight: 400,
          textTransform: 'none' as any,
        },
        contained: {
          ...disabledStyle,
        },
        outlined: {
          ...disabledStyle,
        },
        // primary.main on white is 4.47:1 — fails WCAG 1.4.3 at 14px button
        // text (needs 4.5). primary.dark clears it at 6.29:1.
        containedPrimary: {
          backgroundColor: theme.palette.primary.dark,
          '&:hover': {
            backgroundColor: theme.palette.primary.darker,
          },
        },
        // error.main on white is 3.76:1 — same failure, error.dark clears 4.83:1.
        containedError: {
          backgroundColor: theme.palette.error.dark,
          '&:hover': {
            backgroundColor: theme.palette.error.darker,
          },
        },
      },
    },
  }
}
