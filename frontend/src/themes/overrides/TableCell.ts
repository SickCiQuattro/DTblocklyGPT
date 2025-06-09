import { Theme } from '@mui/material'

export const TableCell = (theme: Theme) => ({
  MuiTableCell: {
    styleOverrides: {
      root: {
        fontSize: '0.875rem',
        padding: 12,
        borderColor: theme.palette.divider,
      },
      head: {
        fontWeight: 600,
        paddingTop: 20,
        paddingBottom: 20,
      },
    },
  },
})
