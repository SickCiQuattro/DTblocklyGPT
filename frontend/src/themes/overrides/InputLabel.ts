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
      // Required-field asterisk: inconsistent across the app for reasons
      // that were never a deliberate design choice (TextField auto-shows
      // it, hand-built FormControl/InputLabel usually doesn't — see
      // LoginForm.tsx's Username vs Password). Required is already
      // communicated where it matters (helper text, aria-invalid, Yup error
      // text) — hide the redundant symbol everywhere instead of patching it
      // field by field.
      asterisk: {
        display: 'none',
      },
    },
  },
})
