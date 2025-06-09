import { RocketFilled, TeamOutlined, ToolOutlined } from '@ant-design/icons'
import { MenuItem } from 'menu-items/types'

export const managementManager: MenuItem = {
  id: 'management',
  title: 'Management',
  type: 'group',
  children: [
    {
      id: 'myrobots',
      title: 'My robots',
      type: 'item',
      url: '/myrobots',
      icon: ToolOutlined,
    },
    {
      id: 'users',
      title: 'Users',
      type: 'item',
      url: '/users',
      icon: TeamOutlined,
    },
    {
      id: 'robots',
      title: 'Robots',
      type: 'item',
      url: '/robots',
      icon: RocketFilled,
    },
  ],
}

export const managementOperator: MenuItem = {
  id: 'management',
  title: 'Management',
  type: 'group',
  children: [
    {
      id: 'myrobots',
      title: 'My robots',
      type: 'item',
      url: '/myrobots',
      icon: ToolOutlined,
    },
  ],
}
