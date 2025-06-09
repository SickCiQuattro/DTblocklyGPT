type MuiLink_defaultProps_underline = 'hover' | 'none' | 'always'

export const Link = () => ({
  MuiLink: {
    defaultProps: {
      underline: 'hover' as MuiLink_defaultProps_underline,
    },
  },
})
