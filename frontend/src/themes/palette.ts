import { createTheme, PaletteMode } from '@mui/material'
import { enUS } from '@mui/material/locale'

import { Theme as ThemeOption } from './theme'

// The design-system palette (themes/theme/index.ts) defines extended ramps
// (lighter → darker) on every semantic color. Teach MUI's types about them so
// `theme.palette.<color>.lighter/.darker` is type-safe at call sites.
declare module '@mui/material/styles' {
  interface PaletteColor {
    lighter: string
    darker: string
  }
  interface SimplePaletteColorOptions {
    lighter?: string
    darker?: string
  }
}

// DTblocklyGPT Design System v1.0
// NOTE: only `.palette` from this module is consumed by themes/index.tsx.
// Typography lives in themes/typography.ts, shadows in themes/shadows.ts,
// and component overrides in themes/overrides/. Do not add typography/
// shape/components here — they would be silently discarded.

export const Palette = (mode: PaletteMode) => {
  const paletteColor = ThemeOption()

  return createTheme(
    {
      palette: {
        mode,
        common: {
          black: '#000',
          white: '#fff',
        },
        primary: {
          lighter: paletteColor.primary.lighter,
          light: paletteColor.primary.light,
          main: paletteColor.primary.main, // #6366F1
          dark: paletteColor.primary.dark,
          darker: paletteColor.primary.darker,
          contrastText: paletteColor.primary.contrastText,
        },
        secondary: {
          lighter: paletteColor.secondary.lighter,
          light: paletteColor.secondary.light,
          main: paletteColor.secondary.main,
          dark: paletteColor.secondary.dark,
          darker: paletteColor.secondary.darker,
          contrastText: paletteColor.secondary.contrastText,
        },
        error: {
          lighter: paletteColor.error.lighter,
          light: paletteColor.error.light,
          main: paletteColor.error.main,
          dark: paletteColor.error.dark,
          darker: paletteColor.error.darker,
          contrastText: paletteColor.error.contrastText,
        },
        warning: {
          lighter: paletteColor.warning.lighter,
          light: paletteColor.warning.light,
          main: paletteColor.warning.main,
          dark: paletteColor.warning.dark,
          darker: paletteColor.warning.darker,
          contrastText: paletteColor.warning.contrastText,
        },
        info: {
          lighter: paletteColor.info.lighter,
          light: paletteColor.info.light,
          main: paletteColor.info.main,
          dark: paletteColor.info.dark,
          darker: paletteColor.info.darker,
          contrastText: paletteColor.info.contrastText,
        },
        success: {
          lighter: paletteColor.success.lighter,
          light: paletteColor.success.light,
          main: paletteColor.success.main,
          dark: paletteColor.success.dark,
          darker: paletteColor.success.darker,
          contrastText: paletteColor.success.contrastText,
        },
        grey: {
          50: paletteColor.grey[1],
          100: paletteColor.grey[2],
          200: paletteColor.grey[3],
          300: paletteColor.grey[4],
          400: paletteColor.grey[5],
          500: paletteColor.grey[6],
          600: paletteColor.grey[7],
          700: paletteColor.grey[8],
          800: paletteColor.grey[9],
          900: paletteColor.grey[10],
          A50: paletteColor.grey[11],
          A100: paletteColor.grey[0],
          A200: paletteColor.grey[13],
          A400: paletteColor.grey[13],
          A700: paletteColor.grey[14],
        } as any,
        text: {
          primary: '#1A1A2E', // Near-black with indigo tint
          secondary: '#5A6270', // Muted — WCAG AA (≈5.6:1 on #F5F5F7)
          disabled: '#9CA3AF', // Faint
        },
        action: {
          disabled: paletteColor.grey[4],
        },
        divider: 'rgba(0, 0, 0, 0.08)',
        background: {
          paper: '#FFFFFF', // Card surfaces
          default: '#F5F5F7', // Warm white — app background
        },
      },
    },
    enUS,
  )
}
