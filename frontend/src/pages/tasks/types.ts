// ─── Lifecycle types ──────────────────────────────────────────────────────────

export type TaskStatus = 'draft' | 'published' | 'published_with_draft'
export type TaskTypeField = 'task' | 'macro_task'

// ─── TaskType (list) ─────────────────────────────────────────────────────────

export interface BaseTaskType {
  id: number
  description: string
  last_modified: string
  name: string
  owner: number
  owner__username: string
  shared: boolean
  task_type: TaskTypeField
  status: TaskStatus
  signature: string
  published_workspace?: Record<string, unknown> | null
}

export interface RegularTaskType extends BaseTaskType {
  task_type: 'task'
}

export interface MacroTaskType extends BaseTaskType {
  task_type: 'macro_task'
}

export type TaskType = RegularTaskType | MacroTaskType

// ─── TaskDetailType ───────────────────────────────────────────────────────────

export type TaskDetailType = {
  id: number
  description: string
  name: string
  shared: boolean
  code: Record<string, unknown> | null
  task_type: TaskTypeField
  status: TaskStatus
  signature: string
}

// ─── Type guards ──────────────────────────────────────────────────────────────

export const isRegularTask = (t: TaskType): t is RegularTaskType =>
  t.task_type === 'task'

export const isMacroTask = (t: TaskType): t is MacroTaskType =>
  t.task_type === 'macro_task'

export const isPublished = (t: TaskType): boolean =>
  t.status === 'published' || t.status === 'published_with_draft'

export const isDraft = (task: TaskType | TaskDetailType): boolean =>
  task.status === 'draft'

export const hasUnpublishedDraft = (task: TaskType | TaskDetailType): boolean =>
  task.status === 'published_with_draft'

// ─── Macro publish payload ────────────────────────────────────────────────────

export interface PublishMacroPayload {
  id: number
  dependencies: number[]
  forcePublish?: boolean
}

export interface PublishMacroResponse {
  signature: string
}

export interface PublishMacroBreakingChanges {
  stale_deps: number[]
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

export type ASTBranch = {
  isMain: boolean
  steps: AbstractStep[]
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
  | AbstractNotifyActionStep
  | AbstractRepeatUntilStep
  | AbstractWaitStep
  | AbstractMacroTaskStep

export type AbstractMacroTaskStep = {
  type: 'macro_task'
  macroId: number | string | null
  macroName: string
}

export type AbstractWaitStep = {
  type: 'wait'
  seconds: number
}

export type AbstractNotifyActionStep = {
  type: 'notify_action'
  description: string
}

export type AbstractRepeatUntilStep = {
  type: 'repeat_until'
  condition: AbstractCondition | null
  steps: AbstractStep[]
}

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
