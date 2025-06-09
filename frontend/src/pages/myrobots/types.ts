export interface MyRobotType {
  id: number
  name: string
  robot: number | null
  robot_name: string
}

export type MyRobotDetailType = Omit<MyRobotType, 'robot_name'>
