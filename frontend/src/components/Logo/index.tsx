import React from 'react'
import { Box, Typography, useTheme } from '@mui/material'

interface LogoSectionProps {
  open?: boolean
}

// Static brand mark — not a link. The sidebar wires its own click behavior
// (expand when collapsed) around this; on its own it does nothing, so it
// doesn't compete with that or read as a stray "go home" affordance.
export const LogoSection = ({ open = true }: LogoSectionProps) => {
  const theme = useTheme()

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        width: 'auto',
      }}
    >
      <img
        src="/logo.svg"
        alt="logo"
        width="28"
        height="28"
        style={{
          marginRight: open ? '10px' : '0',
          transition: 'margin-right 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          flexShrink: 0,
        }}
      />
      <Typography
        sx={{
          color: theme.palette.primary.main,
          fontWeight: 'bold',
          fontSize: '0.95rem',
          letterSpacing: '-0.02em',
          opacity: open ? 1 : 0,
          maxWidth: open ? '150px' : '0px',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          transition:
            'opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), max-width 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        DTblocklyGPT
      </Typography>
    </Box>
  )
}
