import React from 'react'
import { Box } from '@mui/material'

import { Background } from 'components/Logo/Logo'

export const AuthBackground = () => (
  <Box
    sx={{
      position: 'absolute',
      zIndex: -1,
      bottom: 0,
      width: '100%',
      height: '100%',
    }}
  >
    <Background />
  </Box>
)
