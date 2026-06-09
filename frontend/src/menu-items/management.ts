import { Bot, Settings2, Users } from 'lucide-react'

import { MenuItem } from 'menu-items/types'

// MAPPING REFERENCE:
// - Internal variable/import name: management ➔ External group label: OPERATIONS
// - Internal child ID: myrobots ➔ External item label: My Robot
// - Internal child ID: users ➔ External item label: User Accounts
// - Internal child ID: robots ➔ External item label: Robots Fleet
export const managementManager: MenuItem = {
  id: 'operations',
  title: 'OPERATIONS',
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
  title: 'OPERATIONS',
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
