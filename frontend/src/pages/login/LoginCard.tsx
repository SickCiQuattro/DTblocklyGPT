import React, { ReactNode } from 'react'
import { Box, useTheme } from '@mui/material'

import { MainCard } from 'components/MainCard'

interface AuthCardProps {
  children: ReactNode
}

export const LoginCard = ({ children }: AuthCardProps) => {
  const theme = useTheme()
  const shadow = theme.customShadows?.card

  return (
    <MainCard
      sx={{
        width: '100%',
        maxWidth: { xs: 380, sm: 420 },
        '& > *': {
          flexGrow: 1,
          flexBasis: '50%',
        },
      }}
      content={false}
      border={false}
      boxShadow
      shadow={shadow}
    >
      <Box sx={{ p: { xs: 3, sm: 4 } }}>{children}</Box>
    </MainCard>
  )
}
