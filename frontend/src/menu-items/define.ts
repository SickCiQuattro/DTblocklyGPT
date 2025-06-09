import { ApartmentOutlined } from '@ant-design/icons'
import { MenuItem } from 'menu-items/types'

export const define: MenuItem = {
  id: 'define',
  title: 'Define',
  type: 'group',
  children: [
    {
      id: 'tasks',
      title: 'Tasks',
      type: 'item',
      url: '/tasks',
      icon: ApartmentOutlined,
    },
  ],
}
