import { Workflow } from 'lucide-react'

import { MenuItem } from 'menu-items/types'

// MAPPING REFERENCE:
// - Internal variable/import name: define
// - External user-facing group label: STUDIO
export const define: MenuItem = {
  id: 'studio',
  title: 'STUDIO',
  type: 'group',
  children: [
    {
      id: 'tasks',
      title: 'Tasks',
      type: 'item',
      url: '/tasks',
      icon: Workflow,
    },
  ],
}

