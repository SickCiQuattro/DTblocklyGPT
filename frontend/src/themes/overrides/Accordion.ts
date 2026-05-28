export const Accordion = () => ({
  MuiAccordion: {
    defaultProps: {
      disableGutters: true,
      elevation: 0,
      square: true,
    },
    styleOverrides: {
      root: {
        border: '1px solid #e0e0e0',
        borderColor: 'rgba(99, 102, 241, 0.12)',
        borderRadius: '8px !important',
        overflow: 'hidden',
        background: 'rgba(255, 255, 255, 0.4)',
        backdropFilter: 'blur(8px)',
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
        backgroundColor: 'rgba(99, 102, 241, 0.03)',
        '&.Mui-expanded': {
          minHeight: 36,
          backgroundColor: 'rgba(99, 102, 241, 0.06)',
        },
      },
      content: {
        margin: '6px 0',
        '&.Mui-expanded': {
          margin: '6px 0',
        },
      },
      expandIconWrapper: {
        color: '#6366f1',
      },
    },
  },
  MuiAccordionDetails: {
    styleOverrides: {
      root: {
        padding: '12px 16px 14px 16px',
        backgroundColor: '#ffffff',
        borderTop: '1px solid rgba(99, 102, 241, 0.08)',
      },
    },
  },
})
