import { ElementType } from 'react'

export type MenuItem = {
  id: string
  // Optional for 'group' entries with a single child — NavGroupHeader
  // renders a plain hairline divider instead of an all-caps label when a
  // group has no title, since a one-item section doesn't need a heading.
  // Not a hard rule though: `operations` (menu-items/management.ts) sets a
  // title on its single-item group because it sits directly below another
  // titled group, where a title-less item reads as broken rather than minimal
  // — judge by position, not just item count. It also has to be titled because
  // every role sees it: the same destination filed under two different
  // headings was the problem that group split out of.
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
