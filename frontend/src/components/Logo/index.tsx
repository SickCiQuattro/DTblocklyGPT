import React from 'react'
import { Link } from 'react-router-dom'
import { ButtonBase, Typography, useTheme } from '@mui/material'

import { defaultPath } from 'utils/constants'

interface LogoSectionProps {
  open?: boolean
}

export const LogoSection = ({ open = true }: LogoSectionProps) => {
  const theme = useTheme()

  return (
    <ButtonBase
      disableRipple
      component={Link}
      to={defaultPath}
      title="Go to the Homepage"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        width: 'auto',
      }}
    >
      <img
        src="/logo.png"
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
          transition: 'opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), max-width 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        DTblocklyGPT
      </Typography>
    </ButtonBase>
  )
}
