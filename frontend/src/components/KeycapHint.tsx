import React from 'react'
import { Box, BoxProps } from '@mui/material'

/** '⌘' on Mac, 'Ctrl' everywhere else — for real, wired shortcuts only. */
export const modKey = () =>
  typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
    ? '⌘'
    : 'Ctrl'

interface KeycapHintProps extends Omit<BoxProps, 'component'> {
  children: React.ReactNode
}

// Small <kbd> chip for surfacing a real, already-wired keyboard shortcut next
// to the control that triggers it (tooltips, dialog rows, search fields).
export const KeycapHint = ({ children, sx, ...rest }: KeycapHintProps) => (
  <Box
    component="kbd"
    sx={[
      {
        fontFamily: "'Geist Mono', monospace",
        fontSize: '0.7rem',
        lineHeight: 1.6,
        px: 0.5,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: '4px',
        bgcolor: 'grey.50',
        color: 'text.secondary',
      },
      ...(Array.isArray(sx) ? sx : [sx]),
    ]}
    {...rest}
  >
    {children}
  </Box>
)
