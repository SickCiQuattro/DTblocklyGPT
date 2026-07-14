import { createSlice, PayloadAction } from '@reduxjs/toolkit'

import { INITIAL_TASK_STRUCTURE, TaskChatStructure } from 'utils/chat'

export type TaskStatus = 'draft' | 'published' | 'published_with_draft'

export type TaskState = {
  task: TaskChatStructure
  editMode: boolean
  activeTaskId: string | null
  activeTaskName: string
  activeTaskStatus: TaskStatus
  lastSaved: string | null
  chatOpen: boolean
  simOpen: boolean
  codeOpen: boolean
  isSaving: boolean
  saveTriggered: boolean
  discardTriggered: boolean
  // One-shot flag for the StatusBar's "Saved ✓" flash — distinct from
  // lastSaved itself, which is also seeded from the task's own
  // last_modified on load/task-switch (see task-workspace/index.tsx) and
  // must NOT flash the checkmark just because it changed.
  savedFlash: boolean
  workspaceReady: boolean
  chatPosition: 'left' | 'right'
  robotPanelWidth: 'standard' | 'wide'
}

export const initialState: TaskState = {
  task: INITIAL_TASK_STRUCTURE,
  editMode: false,
  activeTaskId: null,
  activeTaskName: 'New Task',
  activeTaskStatus: 'draft',
  lastSaved: null,
  // Defaults open on a fresh browser (helps a first-time operator discover
  // the Copilot) but remembers the user's own choice afterward — same
  // persisted-preference pattern as chatPosition below.
  chatOpen:
    (typeof window !== 'undefined'
      ? localStorage.getItem('chatOpen')
      : null) !== 'false',
  simOpen: false,
  codeOpen: false,
  isSaving: false,
  saveTriggered: false,
  discardTriggered: false,
  savedFlash: false,
  workspaceReady: false,
  chatPosition:
    (typeof window !== 'undefined'
      ? (localStorage.getItem('chatPosition') as 'left' | 'right')
      : null) || 'right',
  robotPanelWidth:
    (typeof window !== 'undefined'
      ? (localStorage.getItem('robotPanelWidth') as 'standard' | 'wide')
      : null) || 'standard',
}

const taskSlice = createSlice({
  name: 'task',
  initialState,
  reducers: {
    updateTask(state, action: PayloadAction<TaskChatStructure>) {
      state.task = action.payload
    },
    resetTask() {
      return initialState
    },
    toggleEditMode(state) {
      state.editMode = !state.editMode
    },
    setActiveTask(
      state,
      action: PayloadAction<{
        id: string | null
        name: string
        status: TaskStatus
      }>,
    ) {
      state.activeTaskId = action.payload.id
      state.activeTaskName = action.payload.name
      state.activeTaskStatus = action.payload.status
    },
    setTaskName(state, action: PayloadAction<string>) {
      state.activeTaskName = action.payload
    },
    setTaskStatus(state, action: PayloadAction<TaskStatus>) {
      state.activeTaskStatus = action.payload
    },
    toggleChat(state) {
      state.chatOpen = !state.chatOpen
      if (typeof window !== 'undefined') {
        localStorage.setItem('chatOpen', String(state.chatOpen))
      }
    },
    toggleSim(state) {
      state.simOpen = !state.simOpen
    },
    toggleCode(state) {
      state.codeOpen = !state.codeOpen
    },
    setSaving(state, action: PayloadAction<boolean>) {
      state.isSaving = action.payload
    },
    triggerSave(state, action: PayloadAction<boolean>) {
      state.saveTriggered = action.payload
    },
    triggerDiscard(state, action: PayloadAction<boolean>) {
      state.discardTriggered = action.payload
    },
    triggerSavedFlash(state, action: PayloadAction<boolean>) {
      state.savedFlash = action.payload
    },
    setWorkspaceReady(state, action: PayloadAction<boolean>) {
      state.workspaceReady = action.payload
    },
    setLastSaved(state, action: PayloadAction<string | null>) {
      state.lastSaved = action.payload
    },
    toggleChatPosition(state) {
      state.chatPosition = state.chatPosition === 'left' ? 'right' : 'left'
      if (typeof window !== 'undefined') {
        localStorage.setItem('chatPosition', state.chatPosition)
      }
    },
    toggleRobotPanelWidth(state) {
      state.robotPanelWidth =
        state.robotPanelWidth === 'standard' ? 'wide' : 'standard'
      if (typeof window !== 'undefined') {
        localStorage.setItem('robotPanelWidth', state.robotPanelWidth)
      }
    },
  },
})

export const {
  toggleEditMode,
  resetTask,
  updateTask,
  setActiveTask,
  setTaskName,
  setTaskStatus,
  toggleChat,
  toggleSim,
  toggleCode,
  setSaving,
  triggerSave,
  triggerDiscard,
  triggerSavedFlash,
  setWorkspaceReady,
  setLastSaved,
  toggleChatPosition,
  toggleRobotPanelWidth,
} = taskSlice.actions

export const taskReducers = taskSlice.reducer
