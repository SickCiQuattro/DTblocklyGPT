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
      direction="column"
      justifyContent="flex-end"
      sx={{ minHeight: '100vh' }}
    >
      <Grid size={12} sx={{ ml: 3, mt: 3 }}>
        <LogoSection />
      </Grid>
      <Grid size={12}>
        <Grid
          size={12}
          container
          justifyContent="center"
          alignItems="center"
          sx={{
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
