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
  // Rename-only save — distinct from saveTriggered, which also
  // (re)publishes the whole workspace when it happens to pass conformance.
  // A rename must never have that side effect (see Header/index.tsx).
  renameTriggered: boolean
  discardTriggered: boolean
  // One-shot flag for the StatusBar's "Saved ✓" flash — distinct from
  // lastSaved itself, which is also seeded from the task's own
  // last_modified on load/task-switch (see task-workspace/index.tsx) and
  // must NOT flash the checkmark just because it changed.
  savedFlash: boolean
  // A save (autosave or manual) failed and hasn't been superseded by a
  // successful one yet. Autosave failures show no toast (they'd fire every
  // 2s while the connection is down), so the StatusBar is the only
  // persistent signal a first-timer has that their latest edits aren't saved.
  saveError: boolean
  workspaceReady: boolean
  // Readable reasons the workspace isn't ready (useConformance's
  // formattedIssues) — mirrored here so Header/index.tsx can show the count
  // next to Save without needing the live Blockly workspace instance itself.
  conformanceIssues: string[]
  // True the instant a structural edit happens, false once the resulting
  // save round-trip completes. Distinct from activeTaskStatus ===
  // 'published_with_draft', which only becomes true after that save
  // actually lands — for a task that WAS published, there's a gap between
  // "edited" and "saved" (the 2s autosave debounce, task-workspace/index.tsx)
  // during which activeTaskStatus still reads 'published'. Run must not
  // treat that gap as "safe to run" — see Header/index.tsx's isRunPrimary
  // and DigitalTwinPanel.tsx's canRun.
  hasUnsavedEdits: boolean
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
  renameTriggered: false,
  discardTriggered: false,
  savedFlash: false,
  saveError: false,
  workspaceReady: false,
  conformanceIssues: [],
  hasUnsavedEdits: false,
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
    triggerRename(state, action: PayloadAction<boolean>) {
      state.renameTriggered = action.payload
    },
    triggerDiscard(state, action: PayloadAction<boolean>) {
      state.discardTriggered = action.payload
    },
    triggerSavedFlash(state, action: PayloadAction<boolean>) {
      state.savedFlash = action.payload
    },
    setSaveError(state, action: PayloadAction<boolean>) {
      state.saveError = action.payload
    },
    setWorkspaceReady(state, action: PayloadAction<boolean>) {
      state.workspaceReady = action.payload
    },
    setConformanceIssues(state, action: PayloadAction<string[]>) {
      state.conformanceIssues = action.payload
    },
    setHasUnsavedEdits(state, action: PayloadAction<boolean>) {
      state.hasUnsavedEdits = action.payload
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
  triggerRename,
  triggerDiscard,
  triggerSavedFlash,
  setSaveError,
  setWorkspaceReady,
  setConformanceIssues,
  setHasUnsavedEdits,
  setLastSaved,
  toggleChatPosition,
  toggleRobotPanelWidth,
} = taskSlice.actions

export const taskReducers = taskSlice.reducer
