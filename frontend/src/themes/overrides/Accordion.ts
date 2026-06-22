import { Theme, alpha } from '@mui/material'

export const Accordion = (theme: Theme) => ({
  MuiAccordion: {
    defaultProps: {
      disableGutters: true,
      elevation: 0,
      square: true,
    },
    styleOverrides: {
      root: {
        border: '1px solid',
        borderColor: alpha(theme.palette.primary.main, 0.12),
        borderRadius: '8px !important',
        overflow: 'hidden',
        background: theme.palette.background.paper,
        '&:not(:last-child)': {
          borderBottom: 0,
          borderBottomLeftRadius: '0px !important',
          borderBottomRightRadius: '0px !important',
        },
        '&:not(:first-of-type)': {
          borderTopLeftRadius: '0px !important',
          borderTopRightRadius: '0px !important',
        },
        '&:before': {
          display: 'none',
        },
      },
    },
  },
  MuiAccordionSummary: {
    styleOverrides: {
      root: {
        minHeight: 36,
        padding: '0 16px',
        backgroundColor: alpha(theme.palette.primary.main, 0.03),
        '&.Mui-expanded': {
          minHeight: 36,
          backgroundColor: alpha(theme.palette.primary.main, 0.06),
        },
      },
      content: {
        margin: '6px 0',
        '&.Mui-expanded': {
          margin: '6px 0',
        },
      },
      expandIconWrapper: {
        color: theme.palette.primary.main,
      },
    },
  },
  MuiAccordionDetails: {
    styleOverrides: {
      root: {
        padding: '12px 16px 14px 16px',
        backgroundColor: theme.palette.background.paper,
        borderTop: `1px solid ${alpha(theme.palette.primary.main, 0.08)}`,
      },
    },
  },
})
