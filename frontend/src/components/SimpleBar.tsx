import React, { ReactNode } from 'react'
import { alpha, styled } from '@mui/material/styles'
import { Box } from '@mui/material'
import SimpleBar from 'simplebar-react'
import { BrowserView, MobileView } from 'react-device-detect'

const RootStyle = styled(BrowserView)({
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
  sx: any
}

export const SimpleBarScroll = ({
  children,
  sx,
  ...other
}: SimpleBarScrollProps) => (
  <>
    <RootStyle>
      <SimpleBarStyle clickOnTrack={false} sx={sx} {...other}>
        {children}
      </SimpleBarStyle>
    </RootStyle>
    <MobileView>
      <Box sx={{ overflowX: 'auto', ...sx }} {...other}>
        {children}
      </Box>
    </MobileView>
  </>
)
