import { Box, MapPin, Zap } from 'lucide-react'

import { MenuItem } from './types'

// MAPPING REFERENCE:
// - Internal variable/import name: libraries ➔ External group label: TWIN LIBRARY
// - Internal child ID: actions (URL: /actions) ➔ External item label: Routines
export const libraries: MenuItem = {
  id: 'twin-library',
  title: 'TWIN LIBRARY',
  type: 'group',
  children: [
    {
      id: 'objects',
      title: 'Objects',
      type: 'item',
      url: '/objects',
      icon: Box,
    },
    {
      id: 'locations',
      title: 'Locations',
      type: 'item',
      url: '/locations',
      icon: MapPin,
    },
    {
      id: 'actions',
      title: 'Routines',
      type: 'item',
      url: '/actions',
      icon: Zap,
    },
  ],
}
