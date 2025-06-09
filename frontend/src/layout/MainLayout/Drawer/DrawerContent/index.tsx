import React from 'react'
import { Navigation } from './Navigation'
import { SimpleBarScroll } from '../../../../components/SimpleBar'

export const DrawerContent = () => (
  <SimpleBarScroll
    sx={{
      '& .simplebar-content': {
        display: 'flex',
        flexDirection: 'column',
      },
    }}
  >
    <Navigation />
  </SimpleBarScroll>
)
