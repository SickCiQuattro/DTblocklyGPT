import React from 'react'
import { Link } from 'react-router-dom'
import { ButtonBase, Typography, useTheme } from '@mui/material'

import { defaultPath } from 'utils/constants'
import { Logo } from './Logo'

export const LogoSection = () => {
  const theme = useTheme()

  return (
    <ButtonBase
      disableRipple
      component={Link}
      to={defaultPath}
      title="Go to the Homepage"
      // style={{ marginTop: '1rem' }}
    >
      <Logo />
      <Typography
        key="logo"
        style={{
          color: theme.palette.primary.main,
          fontWeight: 'bold',
          fontSize: '1rem',
        }}
      >
        DTblocklyGPT
      </Typography>
    </ButtonBase>
  )
}
