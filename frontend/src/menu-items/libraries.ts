import {
  SubnodeOutlined,
  ExperimentOutlined,
  AimOutlined,
} from '@ant-design/icons'
import { MenuItem } from './types'

export const libraries: MenuItem = {
  id: 'libraries',
  title: 'Libraries',
  type: 'group',
  children: [
    {
      id: 'objects',
      title: 'Objects',
      type: 'item',
      url: '/objects',
      icon: AimOutlined,
    },
    {
      id: 'locations',
      title: 'Locations',
      type: 'item',
      url: '/locations',
      icon: ExperimentOutlined,
    },
    {
      id: 'actions',
      title: 'Actions',
      type: 'item',
      url: '/actions',
      icon: SubnodeOutlined,
    },
  ],
}
