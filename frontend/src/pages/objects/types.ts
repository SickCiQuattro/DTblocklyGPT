export interface ObjectListType {
  id: number
  name: string
  owner: number
  shared: boolean
  keywords: string[]
}

export interface ObjectDetailType {
  id: number
  name: string
  shared: boolean
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
