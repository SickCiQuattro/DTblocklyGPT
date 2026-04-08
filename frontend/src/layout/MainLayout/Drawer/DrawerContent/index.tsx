import React from 'react'

import { SimpleBarScroll } from '../../../../components/SimpleBar'

import { Navigation } from './Navigation'

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
