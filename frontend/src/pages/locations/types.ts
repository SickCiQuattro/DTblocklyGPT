export type CartesianPositionType = {
  X: number
  Y: number
  Z: number
  RX: number
  RY: number
  RZ: number
  FIG: number
}

export type JointPositionType = {
  j1: number
  j2: number
  j3: number
  j4: number
  j5: number
  j6: number
  hand: number
}

export interface LocationListType {
  id: number
  name: string
  shared: boolean
  owner: number
  owner__username: string
  keywords: string[]
}

export type LocationDetailType = {
  id: number
  name: string
  shared: boolean
  position: CartesianPositionType | null
  keywords: string[]
}
