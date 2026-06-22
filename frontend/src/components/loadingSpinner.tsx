import React from 'react'
import { CircularProgress } from '@mui/material'

export const LoadingSpinner = () => (
  <CircularProgress
    size={40}
    sx={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      marginTop: '-20px',
      marginLeft: '-20px',
    }}
  />
)
