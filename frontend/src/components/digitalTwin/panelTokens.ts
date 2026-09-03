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
  // The rule, learned the expensive way: an overlay on live video must supply
  // its own ground. It cannot borrow the video's, because the video is not a
  // surface this design controls — it is a picture that changes.
  //
  // Every overlay token here used to be calibrated against `bg` (#0c0c1c), and
  // measured beautifully there. The frame they actually composite over is the
  // Gazebo render, and `worldCobotta.sdf` declares no <background>, so gz-sim
  // falls back to its light default sky over a 0.8-diffuse ground plane. The
  // scene is near-white. Measured on the real thing: the "Show message" pill
  // read 1.59:1 over the sky and 1.01:1 over the ground — the operator's own
  // authored instruction, invisible. "Step completed" read 1.22:1, so a person
  // who performed a gesture correctly got no visible acknowledgement and did
  // it again. On a hardware run the feed is a real room, which this design
  // controls even less.
  //
  // 0.92 is not a taste value. It is the point where every foreground token
  // clears AA against BOTH extremes — white frame and black letterbox — and,
  // more to the point, where the two stop differing much (body text 13.2:1 vs
  // 15.8:1). Above it the chip is opaque and stops reading as an overlay;
  // below it (0.88) primaryLight falls to 4.80 and the margin disappears.
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
 * There were fourteen sizes before this: 0.6 / 0.62 / 0.64 / 0.65 / 0.66 /
 * 0.68 / 0.72 / 0.78 / 0.8 / 0.82 / 0.85 / 0.875 / 0.9 / 1.05 rem. Seven of
 * them sat inside a 9.6–11.5px band — `0.64 → 0.65 → 0.66 → 0.68` is four
 * declared values spanning 0.32 of a pixel. Only one matched a step in the
 * app's own ramp (`themes/typography.ts`).
 *
 * That is not a hierarchy with too many levels; it is the absence of one.
 * Fourteen sizes that a reader cannot tell apart carry exactly as much
 * information as one size, while costing every future edit a decision with no
 * right answer. Steps here are far enough apart to be *seen* — 12 / 13 / 14 /
 * 18 / 24 — so size means something again.
 *
 * The floor is 12px because the panel's audience is a study participant who
 * has never used the app, reading English as a second language, on a laptop,
 * next to a robot arm that is moving. 9.6px was the size of the label naming
 * the camera feed.
 *
 * `display` exists for exactly two things: the seconds left on a step, and the
 * gesture the operator must produce. Both are read under a deadline, at a
 * glance, and both were previously smaller than this paragraph.
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
