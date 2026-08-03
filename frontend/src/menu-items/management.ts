import { Bot, Settings2, Users } from 'lucide-react'

import { MenuItem } from 'menu-items/types'

// MAPPING REFERENCE:
// - Internal variable/import name: managementManager ➔ External group label: Administration
// - Internal variable/import name: managementOperator ➔ External group label: Operations
//   (deliberate exception to the "single-item group needs no heading" convention — this group
//   sits directly below the titled "LIBRARY" group, so a title-less single item reads as broken,
//   not minimal; see menu-items/types.ts)
// - Internal child ID: myrobots ➔ External item label: My Robot
// - Internal child ID: users ➔ External item label: User Accounts
// - Internal child ID: robots ➔ External item label: Robots Fleet
export const managementManager: MenuItem = {
  id: 'operations',
  title: 'Administration',
  type: 'group',
  children: [
    {
      id: 'myrobots',
      title: 'My Robot',
      type: 'item',
      url: '/myrobots',
      icon: Bot,
    },
    {
      id: 'users',
      title: 'User Accounts',
      type: 'item',
      url: '/users',
      icon: Users,
    },
    {
      id: 'robots',
      title: 'Robots Fleet',
      type: 'item',
      url: '/robots',
      icon: Settings2,
    },
  ],
}

export const managementOperator: MenuItem = {
  id: 'operations',
  title: 'Operations',
  type: 'group',
  children: [
    {
      id: 'myrobots',
      title: 'My Robot',
      type: 'item',
      url: '/myrobots',
      icon: Bot,
    },
  ],
}
