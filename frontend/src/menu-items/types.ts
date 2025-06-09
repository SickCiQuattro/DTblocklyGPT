export type MenuItem = {
  id: string
  title: string
  type: 'item' | 'group'
  icon?: any
  url?: string
  children?: MenuItem[]
  target?: string
  external?: boolean
  disabled?: boolean
}
