import React, { ReactNode } from 'react'
import { Box, useTheme } from '@mui/material'

import { MainCard } from 'components/MainCard'

interface AuthCardProps {
  children: ReactNode
}

export const LoginCard = ({ children }: AuthCardProps) => {
  const theme = useTheme()

  return (
    <MainCard
      sx={{
        maxWidth: { xs: 400, lg: 475 },
        margin: { xs: 2.5, md: 3 },
        '& > *': {
          flexGrow: 1,
          flexBasis: '50%',
        },
      }}
      content={false}
      border={false}
      boxShadow
      shadow={(theme as any).customShadows.z1}
    >
      <Box sx={{ p: { xs: 2, sm: 3, md: 4, xl: 5 } }}>{children}</Box>
    </MainCard>
  )
}
