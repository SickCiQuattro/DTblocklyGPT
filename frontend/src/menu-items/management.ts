import { Bot, Boxes, Users } from 'lucide-react'

import { MenuItem } from 'menu-items/types'

// MAPPING REFERENCE:
// - Internal variable/import name: operations ➔ External group label: Operations
// - Internal variable/import name: administration ➔ External group label: Administration
// - Internal child ID: myrobots ➔ External item label: My Robot
// - Internal child ID: users ➔ External item label: User Accounts
// - Internal child ID: robots ➔ External item label: Robot Fleet

/**
 * The operator's own robot. Every role sees it, under this heading.
 *
 * It used to live inside the manager's "Administration" group and inside a
 * separate "Operations" group for everyone else — the same destination, filed
 * under two different words depending on who was looking. It is also not
 * administration: it is the arm assigned to you, sitting beside User Accounts
 * and the fleet, which are.
 *
 * Splitting it out makes the operator's menu a subset of the manager's instead
 * of a different shape, and leaves "Administration" meaning only what is
 * actually manager-only.
 */
export const operations: MenuItem = {
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

/** Manager-only. Nothing here belongs to a single operator. */
export const administration: MenuItem = {
  id: 'administration',
  title: 'Administration',
  type: 'group',
  children: [
    {
      id: 'users',
      title: 'User Accounts',
      type: 'item',
      url: '/users',
      icon: Users,
    },
    {
      id: 'robots',
      // "Robot Fleet", not "Robots Fleet" — the latter is the word order of a
      // literal translation, and it was the only label in the rail with it.
      title: 'Robot Fleet',
      type: 'item',
      url: '/robots',
      // Boxes, not Settings2. Sliders mean configuration, and this is a list of
      // machines; it was also the only place that icon appeared in the whole
      // app, so no internal convention was defending it. What has to read at a
      // glance is the difference from the item above — one robot against many —
      // so the fleet gets a mark of multiplicity while `Bot` stays with the
      // operator's own arm.
      icon: Boxes,
    },
  ],
}
