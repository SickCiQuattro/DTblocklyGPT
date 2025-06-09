export interface RobotType {
  id: number
  name: string
  ip: string
  port: number
  model: string
  cameraip: string
}

export enum RobotModel {
  C = 'Cobotta',
  V = 'VS-060',
}
