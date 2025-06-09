export interface ActionListType {
  id: number
  name: string
  shared: boolean
  owner: number
  owner__username: string
  keywords: string[]
}

export interface ActionDetailType {
  id: number
  name: string
  points: string
  shared: boolean
  speed: number
  pattern: string
  keywords: string[]
}

export const listPatterns = [
  { id: 'L', name: 'Linear' },
  { id: 'C', name: 'Circular' },
  { id: 'X', name: 'Cross' },
]
