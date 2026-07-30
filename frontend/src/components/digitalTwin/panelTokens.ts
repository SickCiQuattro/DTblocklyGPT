import { alpha } from '@mui/material/styles'

import { Theme as ThemeOption } from 'themes/theme'

// The Digital Twin panel is an intentionally-dark monitoring surface (design
// spec §3.6/§3.8) — it doesn't switch with the app's light theme. Brand/status
// colors are pulled from the same design-system ramp everything else uses
// (so a green here is *the* success green, not a lookalike); the dark-surface
// chrome (panel bg, hairlines, muted text) has no light-theme equivalent and
// is named here once instead of repeated as literal rgba(...) through the
// component.
const raw = ThemeOption()

export const panel = {
  bg: '#0c0c1c',
  surface: 'rgba(12, 12, 28, 0.97)',
  overlayScrim: 'rgba(12, 12, 28, 0.78)',
  videoBg: '#000000',
  white: '#ffffff',

  text: '#E2E8F0',
  textDim: '#94A3B8',
  // Was #64748B (4.07:1 on panel.bg, fails AA) — lightened to clear 4.5:1.
  muted: '#70819A',
  border: '#334155',

  // Neutral chrome ladder for dark surfaces (bg tints + hairline borders).
  chrome: 'rgba(255,255,255,0.02)',
  chromeStrong: 'rgba(255,255,255,0.03)',
  hover: 'rgba(255,255,255,0.07)',
  hairline: 'rgba(255,255,255,0.06)',
  hairlineStrong: 'rgba(255,255,255,0.08)',
  trackBg: 'rgba(255,255,255,0.06)', // LinearProgress track on dark
  iconMuted: 'rgba(255,255,255,0.4)',
  videoLabel: 'rgba(255,255,255,0.5)', // overlay label text on a video frame
  selectBorder: 'rgba(255,255,255,0.15)',
  selectBorderHover: 'rgba(255,255,255,0.3)',

  primary: raw.primary.main,
  primaryDark: raw.primary.dark,
  primaryLight: '#818CF8', // primary.400 — accent-light with no direct MUI slot
  primaryFaint: '#A5B4FC',
  primaryTint: (opacity: number) => alpha(raw.primary.main, opacity),

  success: raw.success.main,
  successLight: '#86EFAC',
  successDark: raw.success.dark,
  successTint: (opacity: number) => alpha(raw.success.main, opacity),

  warning: raw.warning.main,
  warningLight: raw.warning.light,
  warningDark: raw.warning.dark,
  warningTint: (opacity: number) => alpha(raw.warning.main, opacity),

  error: raw.error.main,
  errorLight: raw.error.light,
  errorTint: (opacity: number) => alpha(raw.error.main, opacity),
} as const
