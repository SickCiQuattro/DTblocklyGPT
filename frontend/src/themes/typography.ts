// DTblocklyGPT Typography Scale v1.0
// Display: weight 600 (h1) / 500 (h2–h3) + negative letter-spacing (Vercel/Linear pattern)
// Body: 400 weight, 1.5–1.6 line-height
// IBM detail: positive letter-spacing on body2 (0.01em) and caption (0.04em)
export const Typography = (fontFamily: string) => ({
  htmlFontSize: 16,
  fontFamily,
  fontWeightLight: 300,
  fontWeightRegular: 400,
  fontWeightMedium: 500,
  fontWeightBold: 600,
  h1: {
    fontWeight: 600,
    fontSize: '2rem',
    lineHeight: 1.2,
    letterSpacing: '-0.02em',
  },
  h2: {
    fontWeight: 500,
    fontSize: '1.5rem',
    lineHeight: 1.25,
    letterSpacing: '-0.01em',
  },
  h3: {
    fontWeight: 500,
    fontSize: '1.125rem',
    lineHeight: 1.3,
    letterSpacing: 0,
  },
  h4: {
    fontWeight: 600,
    fontSize: '1rem',
    lineHeight: 1.4,
  },
  h5: {
    fontWeight: 600,
    fontSize: '0.875rem',
    lineHeight: 1.4,
  },
  h6: {
    fontWeight: 600,
    fontSize: '0.75rem',
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
    letterSpacing: '0.01em',
  },
  subtitle1: {
    fontSize: '0.875rem',
    fontWeight: 600,
    lineHeight: 1.57,
  },
  subtitle2: {
    fontSize: '0.75rem',
    fontWeight: 500,
    lineHeight: 1.66,
  },
  caption: {
    fontWeight: 400,
    fontSize: '0.75rem',
    lineHeight: 1.4,
    letterSpacing: '0.04em',
  },
  overline: {
    fontSize: '0.72rem',
    fontWeight: 700,
    lineHeight: 1.4,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as any,
  },
  button: {
    fontSize: '0.875rem',
    fontWeight: 500,
    lineHeight: 1.2,
    textTransform: 'none' as any,
  },
})
