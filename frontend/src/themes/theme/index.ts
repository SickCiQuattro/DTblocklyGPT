// DTblocklyGPT Design System v1.0 — MUI Theme Tokens
// Primary: Indigo #6366F1 | Font: Geist → Inter → General Sans
// Light-mode default. Dark mode: border token rgba(99,102,241,0.20).
//
// Single source of truth for raw color values. React code reads colors via
// `theme.palette.*` (derived from here in themes/palette.ts). Non-React Blockly
// config (.ts files that can't use the useTheme hook) imports the named consts
// below directly. Block *category* colors live separately in
// features/blockly/blocks/palette.ts (blocksColours).

/** Brand indigo, for Blockly config that can't reach the MUI theme. */
export const brand = {
  primary: '#6366F1',
  primaryLighter: '#EEF2FF',
} as const

/**
 * Cool slate ramp — UI chrome (surfaces, borders, muted text) used across
 * dialogs, toolbox, and previews. Distinct from the neutral `grey` ramp.
 */
export const slate = {
  50: '#F8FAFC',
  100: '#F1F5F9',
  200: '#E2E8F0',
  300: '#CBD5E1',
  400: '#94A3B8',
  500: '#64748B',
  600: '#475569',
  700: '#334155',
  800: '#1E293B',
  900: '#0F172A',
} as const

/** Terracotta accent — destructive / delete affordances (not the theme red). */
export const accent = {
  lighter: '#FFF7ED',
  light: '#FFEDD5',
  main: '#E15930',
  dark: '#C84D28',
  darker: '#C2410C',
  contrastText: '#FFFFFF',
} as const

/** Neutral grays used by the Blockly canvas chrome (grid, scrollbar, bg). */
export const canvasNeutral = {
  bg: '#F5F5F5',
  scrollbar: '#D9D9D9',
  grid: '#C4C4C4',
} as const

export const Theme = () => {
  const greyPrimary = [
    '#ffffff', // 0
    '#fafafa', // 50
    '#f5f5f5', // 100
    '#f0f0f0', // 200
    '#d9d9d9', // 300
    '#bfbfbf', // 400
    '#8c8c8c', // 500
    '#595959', // 600
    '#262626', // 700
    '#141414', // 800
    '#000000', // 900
  ]
  const greyAscent = ['#fafafa', '#bfbfbf', '#434343', '#1f1f1f']
  const greyConstant = ['#fafafb', '#e6ebf1']

  const grey = [...greyPrimary, ...greyAscent, ...greyConstant]

  return {
    primary: {
      lighter: 'hsl(239, 84%, 95%)', // #eef2ff
      100: 'hsl(239, 84%, 90%)',
      200: 'hsl(239, 84%, 85%)', // #c7d2fe
      light: 'hsl(239, 84%, 75%)',
      400: '#818CF8', // Indigo 400
      main: '#6366F1', // Indigo 500 — brand accent
      dark: '#4F46E5', // Indigo 600
      700: '#4338CA', // Indigo 700
      darker: '#3730A3', // Indigo 800
      900: '#312E81', // Indigo 900
      contrastText: '#FFFFFF',
    },
    secondary: {
      lighter: grey[1],
      100: grey[2],
      200: grey[3],
      light: grey[4],
      400: grey[5],
      main: grey[6],
      600: grey[7],
      dark: grey[8],
      800: grey[9],
      darker: grey[10],
      A50: grey[11],
      A100: grey[0],
      A200: grey[13],
      A300: grey[14],
      contrastText: grey[0],
    },
    error: {
      lighter: '#fde8e8',
      light: '#F87171',
      main: '#EF4444',
      dark: '#DC2626',
      darker: '#B91C1C',
      contrastText: '#FFFFFF',
    },
    warning: {
      lighter: '#fef3c7',
      light: '#FCD34D',
      main: '#F59E0B',
      dark: '#D97706',
      darker: '#B45309',
      contrastText: '#FFFFFF',
    },
    info: {
      lighter: '#e0f2fe',
      light: '#38BDF8',
      main: '#0EA5E9',
      dark: '#0284C7',
      darker: '#0369A1',
      contrastText: '#FFFFFF',
    },
    success: {
      lighter: '#d1fae5',
      light: '#34D399',
      main: '#10B981',
      dark: '#059669',
      darker: '#047857',
      contrastText: '#FFFFFF',
    },
    grey,
    slate,
    accent,
  }
}
