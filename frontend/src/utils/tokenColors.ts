import { Theme as ThemeOption } from 'themes/theme'

// Static snapshot of design-system colors for module-scope / non-hook contexts
// (icon `color` props, helpers that build JSX outside a component). Inside
// components prefer `useTheme()`. Sourced from the single token definition so
// these stay in sync with the theme.
const palette = ThemeOption()

export const tokenColor = {
  successMain: palette.success.main,
  successDarker: palette.success.darker,
  warningDark: palette.warning.dark,
  warningDarker: palette.warning.darker,
  warningContrastText: palette.warning.contrastText,
  infoDark: palette.info.dark,
  inProgressMain: palette.inProgress.main,
  inProgressDark: palette.inProgress.dark,
}
