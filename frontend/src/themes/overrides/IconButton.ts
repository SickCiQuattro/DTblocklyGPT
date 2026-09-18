import { Theme } from '@mui/material'

export const IconButton = (theme: Theme) => ({
  MuiIconButton: {
    styleOverrides: {
      root: {
        borderRadius: 4,
      },
      sizeLarge: {
        width: theme.spacing(5.5),
        height: theme.spacing(5.5),
        fontSize: '1.25rem',
      },
      sizeMedium: {
        width: theme.spacing(4.5),
        height: theme.spacing(4.5),
        fontSize: '1rem',
      },
      sizeSmall: {
        width: theme.spacing(3.75),
        height: theme.spacing(3.75),
        fontSize: '0.75rem',
        // The DRAWN button stays 30px. The TAPPABLE area is 44px, supplied by
        // a transparent pseudo-element centred on it.
        //
        // WCAG 2.2 SC 2.5.8 (AA) asks for 24x24 and 30 already passes, so this
        // is not a compliance fix. It is a fix for who uses this app: an
        // operator standing at the cell with two test tubes in their hands,
        // being timed. Part B counts attempts before a step resolves, so a
        // miss is not just an annoyance here — it lands in the measurement,
        // recorded against the confirmation channel rather than against the
        // button that was too small.
        //
        // Done here rather than at 96 call sites, and as an overlay rather
        // than as padding, because padding would push every toolbar and
        // header row 14px further apart and change the density of the whole
        // app. Nothing moves; only the hit area grows.
        position: 'relative' as const,
        '&::after': {
          content: '""',
          position: 'absolute' as const,
          // 44px total, centred: (44 - 30) / 2 = 7px of overhang per side.
          top: '50%',
          left: '50%',
          width: 44,
          height: 44,
          transform: 'translate(-50%, -50%)',
        },
      },
    },
  },
})
