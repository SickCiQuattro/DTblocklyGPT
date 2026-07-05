import { alpha, Theme } from '@mui/material'

// Stacked-pair shadows (hairline + soft spread) read as considered depth
// rather than a single heavy drop shadow. z1..z4 = increasing elevation;
// card/cardDark are the floating-shell surfaces (workspace panels, MainCard);
// focus is the shared boxShadow ring for non-outline focus affordances
// (OutlinedInput, shadow-picker search) — kept alongside the CssBaseline
// :focus-visible outline, not a replacement for it.
export const CustomShadows = (theme: Theme) => ({
  button: `0 2px #0000000b`,
  text: `0 -1px 0 rgb(0 0 0 / 12%)`,
  focus: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.2)}`,
  z1: `0 1px 2px rgba(0,0,0,0.04), 0 1px 1px rgba(0,0,0,0.03)`,
  z2: `0 2px 4px rgba(0,0,0,0.04), 0 4px 8px rgba(0,0,0,0.04)`,
  z3: `0 4px 8px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.08)`,
  z4: `0 8px 16px rgba(0,0,0,0.06), 0 16px 48px rgba(0,0,0,0.12)`,
  card: `0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)`,
  cardDark: `0 8px 32px rgba(0,0,0,0.35)`,
})

export type CustomShadowsType = ReturnType<typeof CustomShadows>

declare module '@mui/material/styles' {
  interface Theme {
    customShadows: CustomShadowsType
  }
  interface ThemeOptions {
    customShadows?: CustomShadowsType
  }
}
