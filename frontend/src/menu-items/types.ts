import { ElementType } from 'react'

export type MenuItem = {
  id: string
  // Optional for 'group' entries with a single child — NavGroupHeader
  // renders a plain hairline divider instead of an all-caps label when a
  // group has no title, since a one-item section doesn't need a heading.
  // Always present for 'item' entries.
  title?: string
  type: 'item' | 'group'
  icon?: ElementType
  url?: string
  children?: MenuItem[]
  target?: string
  external?: boolean
  disabled?: boolean
}
