import { Theme } from '@mui/material'

// MUI's own focus manager (Button, IconButton, MenuItem, Tab, Checkbox, ...)
// applies `.Mui-focusVisible` instead of the native `:focus-visible` pseudo-class,
// so it needs the same ring as a separate rule from CssBaseline's.
export const ButtonBase = (theme: Theme) => ({
  MuiButtonBase: {
    styleOverrides: {
      root: {
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      },
    },
  },
})
