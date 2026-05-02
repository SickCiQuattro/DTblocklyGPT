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
  id: number | string
  name: string
  weight?: number
  obj_length?: number
  obj_width?: number
}

export type AbstractLocation = {
  id: number | string
  name: string
}

export type AbstractAction = {
  id: number | string
  name: string
}

export type AbstractRobot = {
  id: number | string
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
  | AbstractMoveToStep
  | AbstractMoveRelativeStep
  | AbstractGripperStep
  | AbstractRepeatStep
  | AbstractWhenStep
  | AbstractHumanActionStep
  | AbstractWaitForHumanStep

export type AbstractPickStep = {
  type: 'pick'
  objectId: number | string | null
  objectName: string
}

export type AbstractPlaceStep = {
  type: 'place'
  locationId: number | string | null
  locationName: string
}

export type AbstractProcessingStep = {
  type: 'processing'
  actionId: number | string | null
  actionName: string
}

export type AbstractMoveToStep = {
  type: 'move_to'
  motionType: 'LINEAR' | 'JOINT'
  locationId: number | string | null
  locationName: string
}

export type AbstractMoveRelativeStep = {
  type: 'move_relative'
  axis: 'X' | 'Y' | 'Z'
  distance: number
}

export type AbstractGripperStep = {
  type: 'gripper'
  state: 'OPEN' | 'CLOSE'
}

export type AbstractHumanActionStep = {
  type: 'human_action'
  description: string
  confirmEvent: AbstractCondition | null
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

// Cobotta Conditions
export type AbstractCondition =
  | { type: 'sensor_signal'; sensor: string }
  | { type: 'find_object'; objectId: number | string; objectName: string }
  | { type: 'human_feedback' }
  | { type: 'touch_detect' }
  | { type: 'gesture'; gestureType: 'THUMBS_UP' | 'STOP' | 'OPEN_HAND' }
  | { type: 'timer'; seconds: number }
  | { type: 'and'; left: AbstractCondition; right: AbstractCondition }
  | { type: 'or'; left: AbstractCondition; right: AbstractCondition }
  | { type: 'not'; condition: AbstractCondition }
