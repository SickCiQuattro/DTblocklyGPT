import React from 'react'
import { useTheme } from '@mui/material/styles'
import { Box } from '@mui/material'

interface DotProps {
  color: string
  size?: number
}

export const Dot = ({ color, size = 8 }: DotProps) => {
  const theme = useTheme()
  let main: string
  switch (color) {
    case 'secondary':
      main = theme.palette.secondary.main
      break
    case 'error':
      main = theme.palette.error.main
      break
    case 'warning':
      main = theme.palette.warning.main
      break
    case 'info':
      main = theme.palette.info.main
      break
    case 'success':
      main = theme.palette.success.main
      break
    case 'primary':
    default:
      main = theme.palette.primary.main
  }

  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        bgcolor: main,
      }}
    />
  )
}
