export interface ObjectListType {
  id: number
  name: string
  owner: number
  owner__username?: string
  shared: boolean
  group?: string | null
  keywords: string[]
  obj_length: number
  obj_width: number
  weight: number
}

export interface ObjectDetailType {
  id: number
  name: string
  shared: boolean
  owner: number
  owner__username: string
  height: number | null
  keywords: string[]
  photo: string
  contour: string
  shape: string
  force: number
  weight: number
  obj_length: number
  obj_width: number
}
