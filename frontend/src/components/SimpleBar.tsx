import React, { ReactNode } from 'react'
import { SxProps, Theme, alpha, styled, useTheme } from '@mui/material/styles'
import { Box, useMediaQuery } from '@mui/material'
import SimpleBar from 'simplebar-react'

const RootStyle = styled(Box)({
  flexGrow: 1,
  height: '100%',
  overflow: 'auto',
})

const SimpleBarStyle = styled(SimpleBar)(({ theme }) => ({
  maxHeight: '100%',
  '& .simplebar-scrollbar': {
    '&:before': {
      backgroundColor: alpha(theme.palette.grey[500], 0.48),
    },
    '&.simplebar-visible:before': {
      opacity: 1,
    },
  },
  '& .simplebar-track.simplebar-vertical': {
    width: 10,
  },
  '& .simplebar-track.simplebar-horizontal .simplebar-scrollbar': {
    height: 6,
  },
  '& .simplebar-mask': {
    zIndex: 'inherit',
  },
  '& .simplebar-placeholder': {
    display: 'none',
  },
}))

interface SimpleBarScrollProps {
  children: ReactNode
  sx?: SxProps<Theme>
}

// Custom SimpleBar scrollbars on desktop; native scrolling on touch-sized
// viewports where the OS scrollbar UX is better (was react-device-detect
// BrowserView/MobileView, replaced with the layout's useMediaQuery pattern).
export const SimpleBarScroll = ({
  children,
  sx,
  ...other
}: SimpleBarScrollProps) => {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))

  if (isMobile) {
    return (
      <Box sx={{ overflowX: 'auto', ...sx }} {...other}>
        {children}
      </Box>
    )
  }

  return (
    <RootStyle>
      <SimpleBarStyle clickOnTrack={false} sx={sx} {...other}>
        {children}
      </SimpleBarStyle>
    </RootStyle>
  )
}
