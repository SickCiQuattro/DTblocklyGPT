export interface ActionListType {
  id: number
  name: string
  group?: string | null
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
  owner: number
  owner__username: string
  speed: number
  pattern: string
  keywords: string[]
}

export const listPatterns = [
  { id: 'L', name: 'Linear' },
  { id: 'C', name: 'Circular' },
  { id: 'X', name: 'Cross' },
]

export type AbstractMacroStep = {
  type: 'macro'
  taskId: number | string
  taskName: string
}
