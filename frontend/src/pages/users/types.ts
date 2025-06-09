export interface UserListType {
  id: number
  username: string
  email: string
  is_active: boolean
  date_joined: string
  last_login: string
  role: string
}

export interface UserDetailType {
  id: number
  username: string
  email: string
  first_name: string
  last_name: string
  role: number | null
}

export interface RoleType {
  id: number
  name: string
}
