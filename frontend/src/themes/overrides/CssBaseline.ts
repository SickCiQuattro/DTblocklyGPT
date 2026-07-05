import { Theme } from '@mui/material'

// App-wide accessibility baseline: the keyboard focus ring every element gets
// by default, and honoring the user's reduced-motion preference so individual
// components don't each need a media query.
export const CssBaseline = (theme: Theme) => ({
  MuiCssBaseline: {
    styleOverrides: {
      // The app has one light theme, no dark variant. Without this, a
      // browser/OS in dark mode can still auto-darken native chrome the page
      // itself never styles (native scrollbars, form widgets) — inconsistent
      // dark patches on an otherwise all-light UI.
      ':root': {
        colorScheme: 'light',
      },
      ':focus-visible': {
        outline: `2px solid ${theme.palette.primary.main}`,
        outlineOffset: '2px',
      },
      '@media (prefers-reduced-motion: reduce)': {
        '*, *::before, *::after': {
          animationDuration: '0.01ms !important',
          animationIterationCount: '1 !important',
          transitionDuration: '0.01ms !important',
          scrollBehavior: 'auto !important',
        },
      },
    },
  },
})
