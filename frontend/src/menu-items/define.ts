import { Workflow } from 'lucide-react'

import { MenuItem } from 'menu-items/types'

// MAPPING REFERENCE:
// - Internal variable/import name: define
// - No group label — a single-item group ("Tasks") doesn't need a heading.
export const define: MenuItem = {
  id: 'studio',
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
