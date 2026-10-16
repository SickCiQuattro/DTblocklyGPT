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
  videoBg: '#000000',
  white: '#ffffff',

  // ── Anything drawn ON TOP OF THE VIDEO uses one of these two ─────────────
  //
  // An overlay on live video must supply its own ground; it cannot borrow the
  // video's, because the video is a picture that changes.
  //
  // Tokens calibrated against `bg` (#0c0c1c) measure well there but not over
  // the Gazebo render: `worldCobotta.sdf` declares no <background>, so gz-sim
  // falls back to its light default sky over a 0.8-diffuse ground plane, and
  // the scene is near-white. Measured there, the "Show message" pill read
  // 1.59:1 over the sky and 1.01:1 over the ground, and "Step completed"
  // 1.22:1. On a hardware run the feed is a real room, which this design
  // controls even less.
  //
  // 0.92 is not a taste value. It is where every foreground token clears AA
  // against BOTH extremes (white frame and black letterbox) and where the two
  // stop differing much (body text 13.2:1 vs 15.8:1). Above it the chip is
  // opaque and stops reading as an overlay; below it (0.88) primaryLight falls
  // to 4.80 and the margin disappears.
  /** Compact overlay (pill, chip, label) sitting directly on video. */
  overlayChip: 'rgba(12, 12, 28, 0.92)',
  /** Full-cover overlay that takes the video for the duration of a wait. */
  overlayScrim: 'rgba(12, 12, 28, 0.92)',

  text: '#E2E8F0',
  textDim: '#94A3B8',
  // Was #64748B (4.07:1), then #70819A, and both were measured against the
  // wrong background. `bg` is a swatch this panel never actually paints: the
  // panel is `surface` at 0.97 over the app's #F5F5F7 page, which composites
  // to #131323 — lighter than `bg`, so every ratio computed against `bg` is
  // optimistic. #70819A read 4.88:1 on the swatch and 4.62:1 on the real
  // surface, and 4.32:1 on `chromeStrong`, where it is used. It failed AA in
  // the Events rows and the legend headings while its own comment said it
  // passed.
  //
  // #77889F clears 4.5:1 against the WORST ground it sits on (4.74 on
  // chromeStrong, 5.07 on the panel) and stays a visible step below textDim
  // (luminance 0.24 vs 0.36), which is the only reason this token exists.
  muted: '#77889F',
  border: '#334155',

  // Neutral chrome ladder for dark surfaces (bg tints + hairline borders).
  chrome: 'rgba(255,255,255,0.02)',
  chromeStrong: 'rgba(255,255,255,0.03)',
  hover: 'rgba(255,255,255,0.07)',
  hairline: 'rgba(255,255,255,0.06)',
  hairlineStrong: 'rgba(255,255,255,0.08)',
  trackBg: 'rgba(255,255,255,0.06)', // LinearProgress track on dark
  iconMuted: 'rgba(255,255,255,0.4)',
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

/**
 * The panel's type scale. Five steps, and a 12px floor.
 *
 * Steps are far enough apart to be *seen* — 12 / 13 / 14 / 18 / 24 — so size
 * means something: sizes a reader cannot tell apart carry as much information as
 * one size and cost every future edit a decision with no right answer.
 *
 * The floor is 12px because the panel's audience is a study participant who has
 * never used the app, reading English as a second language, on a laptop, next to
 * a robot arm that is moving.
 *
 * `display` exists for exactly two things: the seconds left on a step, and the
 * gesture the operator must produce. Both are read under a deadline, at a glance.
 */
export const panelType = {
  /** 12px — captions, section labels, legend chips, units. The floor. */
  micro: '0.75rem',
  /** 13px — secondary text, pre-run notices, helper lines. */
  small: '0.8125rem',
  /** 14px — primary text, status, anything that is a sentence. */
  body: '0.875rem',
  /** 18px — the instruction the operator must act on. */
  lead: '1.125rem',
  /** 24px — read under a deadline: seconds remaining, gesture required. */
  display: '1.5rem',
} as const
