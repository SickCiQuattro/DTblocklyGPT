import React from 'react'
import { Box } from '@mui/material'
import { HelpCircle } from 'lucide-react'

import { MenuItem } from 'menu-items/types'

import { SimpleBarScroll } from '../../../../components/SimpleBar'

import { Navigation } from './Navigation'
import { NavItem } from './Navigation/NavItem'

// FAQ goes through the shared NavItem so it inherits the exact rail row metric,
// icon column, tooltip, and selected pill — no special-case styling.
const faqItem: MenuItem = {
  id: 'faq',
  title: 'Instructions & FAQ',
  type: 'item',
  url: '/faq',
  icon: HelpCircle,
}

interface DrawerContentProps {
  open: boolean
}

export const DrawerContent = (_props: DrawerContentProps) => {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Scrollable navigation items */}
      <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
        <SimpleBarScroll
          sx={{
            height: '100%',
            '& .simplebar-content': {
              display: 'flex',
              flexDirection: 'column',
            },
          }}
        >
          <Navigation />
        </SimpleBarScroll>
      </Box>

      {/* Pinned help link — same rail row metric as the nav items above */}
      <Box
        sx={{
          py: 1,
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <NavItem item={faqItem} level={1} />
      </Box>
    </Box>
  )
}
