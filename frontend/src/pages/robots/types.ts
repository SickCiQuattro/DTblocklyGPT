export interface RobotType {
  id: number
  name: string
  ip: string
  port: number
  model: string
  cameraip: string
  max_load: number
  max_open_tool: number
}

export enum RobotModel {
  C = 'Cobotta',
  V = 'VS-060',
}
