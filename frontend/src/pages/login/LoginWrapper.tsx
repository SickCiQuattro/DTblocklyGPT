import React, { ReactNode } from 'react'
import { Box, Grid } from '@mui/material'

import { LogoSection } from 'components/Logo'
import { AuthBackground } from 'assets/AuthBackground'

import { LoginCard } from './LoginCard'

interface AuthWrapperProps {
  children: ReactNode
}

export const LoginWrapper = ({ children }: AuthWrapperProps) => (
  <Box sx={{ minHeight: '100vh' }}>
    <AuthBackground />
    <Grid
      container
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      <Grid size={12} sx={{ ml: 3, mt: 3 }}>
        <LogoSection />
      </Grid>
      <Grid size={12}>
        <Grid
          size={12}
          container
          sx={{
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: { xs: 'calc(100vh - 134px)', md: 'calc(100vh - 112px)' },
          }}
        >
          <Grid>
            <LoginCard>{children}</LoginCard>
          </Grid>
        </Grid>
      </Grid>
    </Grid>
  </Box>
)
