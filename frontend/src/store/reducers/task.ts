import { createSlice, PayloadAction } from '@reduxjs/toolkit'

import { INITIAL_TASK_STRUCTURE, TaskChatStructure } from 'pages/chat/utils'

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
  workspaceReady: boolean
  chatPosition: 'left' | 'right'
}

export const initialState: TaskState = {
  task: INITIAL_TASK_STRUCTURE,
  editMode: false,
  activeTaskId: null,
  activeTaskName: 'New Task',
  activeTaskStatus: 'draft',
  lastSaved: null,
  chatOpen: true,
  simOpen: false,
  codeOpen: false,
  isSaving: false,
  saveTriggered: false,
  discardTriggered: false,
  workspaceReady: false,
  chatPosition: (typeof window !== 'undefined' ? (localStorage.getItem('chatPosition') as 'left' | 'right') : null) || 'right',
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
      action: PayloadAction<{ id: string | null; name: string; status: TaskStatus }>
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
  setWorkspaceReady,
  setLastSaved,
  toggleChatPosition,
} = taskSlice.actions

export const taskReducers = taskSlice.reducer

