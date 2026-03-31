export interface TaskType {
  id: number
  description: string
  last_modified: string
  name: string
  owner: string
  owner__username: string
  shared: boolean
  code: string
}

export type TaskDetailType = {
  id: number
  description: string
  name: string
  shared: boolean
  code: string
}

export type AbstractObject = {
  id: number
  name: string
  weight?: number
  obj_length?: number
  obj_width?: number
}

export type AbstractLocation = {
  id: number
  name: string
}

export type AbstractAction = {
  id: number
  name: string
}

export type AbstractRobot = {
  id: number
  max_open_tool?: number
  max_load?: number
}

export type AbstractTask = {
  taskName: string
  description?: string
  steps: AbstractStep[]
  objects?: AbstractObject[]
  locations?: AbstractLocation[]
  actions?: AbstractAction[]
  robot?: AbstractRobot
}

export type AbstractStep =
  | AbstractPickStep
  | AbstractPlaceStep
  | AbstractProcessingStep
  | AbstractRepeatStep
  | AbstractWhenStep
  | AbstractWaitForHumanStep

export type AbstractPickStep = {
  type: 'pick'
  objectId: number
  objectName: string
}

export type AbstractPlaceStep = {
  type: 'place'
  locationId: number
  locationName: string
}

export type AbstractProcessingStep = {
  type: 'processing'
  actionId: number
  actionName: string
}

export type AbstractRepeatStep = {
  type: 'repeat'
  times: number
  steps: AbstractStep[]
}

export type AbstractWhenStep = {
  type: 'when'
  condition: AbstractCondition | null
  do: AbstractStep[]
  otherwise?: AbstractStep[]
}

export type AbstractWaitForHumanStep = {
  type: 'wait_for_human'
  description?: string
}

export type AbstractCondition =
  | { type: 'sensor_signal'; sensor: string }
  | { type: 'find_object'; objectId: number; objectName: string }
  | { type: 'human_feedback' }
