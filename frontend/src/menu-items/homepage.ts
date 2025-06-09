import { HomeOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { MenuItem } from './types'

export const homepage: MenuItem = {
  id: 'homepage-group',
  title: '',
  type: 'group',
  children: [
    {
      id: 'homepage',
      title: 'Homepage',
      type: 'item',
      url: '/',
      icon: HomeOutlined,
    },
    {
      id: 'faq',
      title: 'Instructions & FAQ',
      type: 'item',
      url: '/faq',
      icon: QuestionCircleOutlined,
    },
  ],
}
