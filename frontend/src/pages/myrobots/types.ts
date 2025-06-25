export interface MyRobotType {
  id: number
  name: string
  robot: number | null
  robot_name: string
  robot__max_load: number | null
  robot__max_open_tool: number | null
}

export type MyRobotDetailType = Omit<MyRobotType, 'robot_name'>
