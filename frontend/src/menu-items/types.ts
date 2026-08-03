import { ElementType } from 'react'

export type MenuItem = {
  id: string
  // Optional for 'group' entries with a single child — NavGroupHeader
  // renders a plain hairline divider instead of an all-caps label when a
  // group has no title, since a one-item section doesn't need a heading.
  // Not a hard rule though: managementOperator (menu-items/management.ts)
  // deliberately sets a title on its single-item group because it sits
  // directly below another titled group, where a title-less item reads as
  // broken rather than minimal — judge by position, not just item count.
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
