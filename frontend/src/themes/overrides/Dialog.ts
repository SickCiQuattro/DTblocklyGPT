import { Theme } from '@mui/material'

// One paper/title standard for every dialog in the app (task modals, Blockly
// editor confirms, macro preview, digital-twin run-confirm). Individual
// dialogs no longer hand-roll their own radius/shadow/title weight.
export const Dialog = (theme: Theme) => ({
  MuiDialog: {
    styleOverrides: {
      paper: {
        borderRadius: 12,
        border: `1px solid ${theme.palette.slate[200]}`,
        boxShadow: theme.customShadows.z3,
      },
    },
  },
  MuiDialogTitle: {
    styleOverrides: {
      root: {
        fontSize: '1.05rem',
        fontWeight: 600,
        color: theme.palette.slate[900],
      },
    },
  },
})
