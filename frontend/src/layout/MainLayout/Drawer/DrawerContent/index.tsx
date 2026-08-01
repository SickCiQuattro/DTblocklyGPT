import React from 'react'
import { Box, Divider } from '@mui/material'
import { HelpCircle } from 'lucide-react'

import { MenuItem } from 'menu-items/types'

import { Navigation } from './Navigation'
import { NavItem, NAV_SEPARATOR_HEIGHT } from './Navigation/NavItem'

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

export const DrawerContent = ({ open }: DrawerContentProps) => {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Scrollable navigation items. Native scrolling on purpose: this list
          is a handful of rows and only scrolls on a very short viewport.
          A JS scrollbar library used to wrap it, but its stylesheet was never
          imported, so its track rendered as an unstyled block in normal flow —
          a grey bar under the last nav item that filled in as the library
          measured and set the scrollbar width inline. */}
      <Box
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        <Navigation />
      </Box>

      {/* Pinned help link — same rail row metric as the nav items above. */}
      <Box sx={{ pb: 1, bgcolor: 'background.paper' }}>
        {/* Separator keeps NAV_SEPARATOR_HEIGHT in both states so toggling
            the rail never moves the FAQ row (same rule as NavGroupHeader).
            Collapsed: short centered hairline matching the group dividers
            above; open: full width, like the footer border it replaces. It
            is its own row rather than a border on this Box, so NavItem's
            button still stretches full width like every other item. */}
        <Box
          aria-hidden
          sx={{
            height: NAV_SEPARATOR_HEIGHT,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Divider sx={{ width: open ? '100%' : 24, borderColor: 'divider' }} />
        </Box>
        <NavItem item={faqItem} level={1} />
      </Box>
    </Box>
  )
}
