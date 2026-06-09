import { createTheme, PaletteMode } from '@mui/material'
import { itIT } from '@mui/material/locale'

import { Theme as ThemeOption } from './theme'

// DTblocklyGPT Design System v1.0
// Font stack: Geist (Vercel OSS, 2023) → Inter → General Sans → system
// Typography scale: display weight 600/500 + negative letter-spacing (Linear/Vercel pattern)
// Borders: alpha-blended rgba(99, 102, 241, 0.12) — indigo-tinted, never solid colored

const FONT_FAMILY =
  "'Geist', 'Inter', 'General Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"

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
        } as any,
        secondary: {
          lighter: paletteColor.secondary.lighter,
          light: paletteColor.secondary.light,
          main: paletteColor.secondary.main,
          dark: paletteColor.secondary.dark,
          darker: paletteColor.secondary.darker,
          contrastText: paletteColor.secondary.contrastText,
        } as any,
        error: {
          lighter: paletteColor.error.lighter,
          light: paletteColor.error.light,
          main: paletteColor.error.main,
          dark: paletteColor.error.dark,
          darker: paletteColor.error.darker,
          contrastText: paletteColor.error.contrastText,
        } as any,
        warning: {
          lighter: paletteColor.warning.lighter,
          light: paletteColor.warning.light,
          main: paletteColor.warning.main,
          dark: paletteColor.warning.dark,
          darker: paletteColor.warning.darker,
          contrastText: paletteColor.warning.contrastText,
        } as any,
        info: {
          lighter: paletteColor.info.lighter,
          light: paletteColor.info.light,
          main: paletteColor.info.main,
          dark: paletteColor.info.dark,
          darker: paletteColor.info.darker,
          contrastText: paletteColor.info.contrastText,
        } as any,
        success: {
          lighter: paletteColor.success.lighter,
          light: paletteColor.success.light,
          main: paletteColor.success.main,
          dark: paletteColor.success.dark,
          darker: paletteColor.success.darker,
          contrastText: paletteColor.success.contrastText,
        } as any,
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
          primary: '#1A1A2E', // Quasi-nero con tinta indigo
          secondary: '#6B7280', // Muted
          disabled: '#9CA3AF', // Faint
        },
        action: {
          disabled: paletteColor.grey[4],
        },
        divider: 'rgba(0, 0, 0, 0.08)',
        background: {
          paper: '#FFFFFF', // Card surfaces
          default: '#F5F5F7', // Warm white — sfondo app
        },
      },

      // ── Typography ──────────────────────────────────────────────────────────
      typography: {
        fontFamily: FONT_FAMILY,
        // Display: weight 600 + negative tracking (Vercel/Linear pattern)
        h1: {
          fontSize: '2rem',
          fontWeight: 600,
          lineHeight: 1.2,
          letterSpacing: '-0.02em',
        },
        h2: {
          fontSize: '1.5rem',
          fontWeight: 500,
          lineHeight: 1.25,
          letterSpacing: '-0.01em',
        },
        h3: {
          fontSize: '1.125rem',
          fontWeight: 500,
          lineHeight: 1.3,
          letterSpacing: 0,
        },
        h4: {
          fontSize: '1rem',
          fontWeight: 600,
          lineHeight: 1.4,
        },
        h5: {
          fontSize: '0.875rem',
          fontWeight: 600,
          lineHeight: 1.4,
        },
        h6: {
          fontSize: '0.75rem',
          fontWeight: 600,
          lineHeight: 1.4,
        },
        body1: {
          fontSize: '1rem',
          lineHeight: 1.6,
          fontWeight: 400,
        },
        body2: {
          fontSize: '0.875rem',
          lineHeight: 1.5,
          fontWeight: 400,
          letterSpacing: '0.01em', // IBM Carbon precision detail
        },
        caption: {
          fontSize: '0.75rem',
          lineHeight: 1.4,
          letterSpacing: '0.04em',
        },
        button: {
          fontSize: '0.875rem',
          fontWeight: 500,
          lineHeight: 1.2,
          textTransform: 'none', // No uppercase buttons
        },
        overline: {
          fontSize: '0.72rem',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          lineHeight: 1.4,
        },
      },

      // ── Shape ───────────────────────────────────────────────────────────────
      shape: {
        borderRadius: 8, // --radius-md base (buttons, inputs, cards)
      },

      // ── Component overrides ─────────────────────────────────────────────────
      components: {
        MuiButton: {
          styleOverrides: {
            root: {
              fontFamily: FONT_FAMILY,
              fontWeight: 500,
              borderRadius: 8,
              textTransform: 'none',
              boxShadow: 'none',
              '&:hover': { boxShadow: 'none' },
            },
          },
        },
        MuiInputBase: {
          styleOverrides: {
            root: { fontFamily: FONT_FAMILY },
          },
        },
        MuiAppBar: {
          styleOverrides: {
            root: {
              backgroundColor: '#FFFFFF',
              borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
              boxShadow: 'none',
              height: 56,
            },
          },
        },
        MuiDrawer: {
          styleOverrides: {
            paper: {
              borderRight: '1px solid rgba(0, 0, 0, 0.08)',
              boxShadow: 'none',
              backgroundColor: '#FFFFFF',
            },
          },
        },
        MuiTableCell: {
          styleOverrides: {
            root: { fontFamily: FONT_FAMILY },
          },
        },
        MuiChip: {
          styleOverrides: {
            root: {
              fontFamily: FONT_FAMILY,
              fontWeight: 500,
            },
          },
        },
      },
    },
    itIT,
  )
}
