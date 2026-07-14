import React, { ReactNode } from 'react'
import { Box, Stack } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'

import { LogoSection } from 'components/Logo'

import { LoginCard } from './LoginCard'

interface AuthWrapperProps {
  children: ReactNode
}

export const LoginWrapper = ({ children }: AuthWrapperProps) => {
  const theme = useTheme()

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
        py: 6,
        bgcolor: 'background.default',
        // A quiet radial tint instead of a background image — brand color,
        // not a photo, and subtle enough to stay out of the way of the form.
        backgroundImage: `radial-gradient(ellipse 70% 45% at 50% -8%, ${alpha(
          theme.palette.primary.main,
          0.07,
        )}, transparent)`,
      }}
    >
      <Stack spacing={4} sx={{ alignItems: 'center', width: '100%' }}>
        <LogoSection />
        <LoginCard>{children}</LoginCard>
      </Stack>
    </Box>
  )
}
