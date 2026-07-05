import { alpha, Theme } from '@mui/material'

export const OutlinedInput = (theme: Theme) => ({
  MuiOutlinedInput: {
    styleOverrides: {
      input: {
        padding: '10.5px 14px 10.5px 12px',
      },
      notchedOutline: {
        // grey[500] clears the WCAG 1.4.11 3:1 UI-boundary floor; grey[300]
        // (~1.4:1) was effectively invisible against a white field.
        borderColor: theme.palette.grey[500],
      },
      root: {
        '&:hover .MuiOutlinedInput-notchedOutline': {
          borderColor: theme.palette.primary.light,
        },
        '&.Mui-focused': {
          boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.2)}`,
          '& .MuiOutlinedInput-notchedOutline': {
            border: `1px solid ${theme.palette.primary.light}`,
          },
        },
        '&.Mui-error': {
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: theme.palette.error.light,
          },
          '&.Mui-focused': {
            boxShadow: `0 0 0 2px ${alpha(theme.palette.error.main, 0.2)}`,
            '& .MuiOutlinedInput-notchedOutline': {
              border: `1px solid ${theme.palette.error.light}`,
            },
          },
        },
      },
      inputSizeSmall: {
        padding: '7.5px 8px 7.5px 12px',
      },
      inputMultiline: {
        padding: 0,
      },
    },
  },
})
