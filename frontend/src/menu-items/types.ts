import { ElementType } from 'react'

export type MenuItem = {
  id: string
  title: string
  type: 'item' | 'group'
  icon?: ElementType
  url?: string
  children?: MenuItem[]
  target?: string
  external?: boolean
  disabled?: boolean
}
