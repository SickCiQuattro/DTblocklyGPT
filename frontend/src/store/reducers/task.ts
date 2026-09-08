import { createSlice, PayloadAction } from '@reduxjs/toolkit'

import { INITIAL_TASK_STRUCTURE, TaskChatStructure } from 'utils/chat'

/**
 * Robot panel resize bounds, in px.
 *
 * The floor is what the panel needs to stay useful: the 4:3 live view plus the
 * Required/Detected readout side by side. Below it the readout wraps and the
 * video is a thumbnail, which is not a narrower panel but a broken one.
 *
 * There is no ceiling here on purpose — it depends on the viewport and on
 * Copilot's current width, so it lives in the panel's own CSS clamp.
 */
export const ROBOT_PANEL_MIN_PX = 360
export const ROBOT_PANEL_DEFAULT_PX = 520

/**
 * Task-code panel resize bounds, in px, and the height of its collapsed rail.
 *
 * The floor is the height at which the JSON is still worth reading — roughly
 * six lines plus the header. Below that the panel costs its own chrome and
 * shows less than the tooltip it replaced.
 *
 * `CODE_PANEL_RAIL_PX` is the closed state, and it is deliberately not zero.
 * The panel used to collapse to `height: 0` and the dark hairline still visible
 * along the bottom edge was an accident: a semi-transparent `border-top` on a
 * zero-height box, showing the panel's own background through it. It read as a
 * closed drawer, which is exactly right — so it is a real rail now, thick
 * enough to click and to grab, instead of a 1px side effect that could vanish
 * with any change to the border.
 */
export const CODE_PANEL_MIN_PX = 120
export const CODE_PANEL_DEFAULT_PX = 220
export const CODE_PANEL_RAIL_PX = 5

export type TaskStatus = 'draft' | 'published' | 'published_with_draft'

export type TaskState = {
  task: TaskChatStructure
  editMode: boolean
  activeTaskId: string | null
  activeTaskName: string
  /** Authored in the workspace header, beside the name. Metadata: it is PUT on
   *  its own, never through the publish path. */
  activeTaskDescription: string
  activeTaskStatus: TaskStatus
  lastSaved: string | null
  chatOpen: boolean
  simOpen: boolean
  codeOpen: boolean
  isSaving: boolean
  /** Only the discard-draft request. isSaving is set by every save
   *  path, so it cannot be used to tell when a discard finished. */
  isDiscarding: boolean
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
  // True when the loaded task is shared and NOT owned by the current user —
  // read access is legitimate (task_detail's GET allows owner-or-shared),
  // but every write endpoint is owner-only. Drives the Header's read-only
  // banner/disabled Save-Publish-Discard-Rename and blocks the autosave
  // debounce at the source in task-workspace/index.tsx, instead of letting
  // it hit the backend and surface as a generic "Task not found" toast.
  isReadOnly: boolean
  ownerUsername: string | null
  chatPosition: 'left' | 'right'
  /**
   * Robot panel width in px, drag-resizable like Copilot.
   *
   * Was `'standard' | 'wide'` — a two-step snap, while Copilot next to it was
   * dragged freely. Two peers, two ways of doing the same thing, which is the
   * inconsistency this replaces. The panel clamps this against the workspace's
   * own minimum at render time, so a value stored on a wide screen does not
   * squeeze the workspace on a narrow one.
   */
  robotPanelWidth: number
  /** Task-code panel height, in px. Dragged from its top edge, same as the
   *  two side panels are dragged from theirs. */
  codePanelHeight: number
}

export const initialState: TaskState = {
  task: INITIAL_TASK_STRUCTURE,
  editMode: false,
  activeTaskId: null,
  activeTaskName: 'New Task',
  activeTaskDescription: '',
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
  isDiscarding: false,
  saveTriggered: false,
  renameTriggered: false,
  discardTriggered: false,
  savedFlash: false,
  saveError: false,
  workspaceReady: false,
  conformanceIssues: [],
  hasUnsavedEdits: false,
  isReadOnly: false,
  ownerUsername: null,
  chatPosition:
    (typeof window !== 'undefined'
      ? (localStorage.getItem('chatPosition') as 'left' | 'right')
      : null) || 'right',
  robotPanelWidth:
    (typeof window !== 'undefined'
      ? Number(localStorage.getItem('robotPanelWidth'))
      : 0) || ROBOT_PANEL_DEFAULT_PX,
  codePanelHeight:
    (typeof window !== 'undefined'
      ? Number(localStorage.getItem('codePanelHeight'))
      : 0) || CODE_PANEL_DEFAULT_PX,
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
        isReadOnly?: boolean
        ownerUsername?: string | null
        description?: string
      }>,
    ) {
      state.activeTaskId = action.payload.id
      state.activeTaskName = action.payload.name
      state.activeTaskStatus = action.payload.status
      state.isReadOnly = action.payload.isReadOnly ?? false
      state.ownerUsername = action.payload.ownerUsername ?? null
      // Assigned only when the key is present, NOT `?? ''`.
      //
      // This action is dispatched from seven places and only the two that load
      // a task pass the full record; the five that follow a save re-state just
      // id/name/status. A defaulting `??` would therefore blank the header's
      // description on every autosave — which is every two seconds while the
      // operator types. (`isReadOnly` and `ownerUsername` above have the same
      // shape and are safe only because a read-only task cannot reach any of
      // those five paths.)
      if (action.payload.description !== undefined) {
        state.activeTaskDescription = action.payload.description
      }
    },
    setTaskName(state, action: PayloadAction<string>) {
      state.activeTaskName = action.payload
    },
    setTaskDescription(state, action: PayloadAction<string>) {
      state.activeTaskDescription = action.payload
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
    setDiscarding(state, action: PayloadAction<boolean>) {
      state.isDiscarding = action.payload
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
    /**
     * Set the robot panel's width, in px.
     *
     * Only the lower bound is enforced here. The upper one depends on the
     * viewport and on Copilot's current footprint, neither of which a reducer
     * can see — the panel clamps it in CSS at render time, which also keeps it
     * correct when the window is resized without anything being dispatched.
     */
    setRobotPanelWidth(state, action: PayloadAction<number>) {
      state.robotPanelWidth = Math.max(ROBOT_PANEL_MIN_PX, action.payload)
      if (typeof window !== 'undefined') {
        localStorage.setItem('robotPanelWidth', String(state.robotPanelWidth))
      }
    },
    /** Same contract as setRobotPanelWidth: floor here, ceiling in CSS. */
    setCodePanelHeight(state, action: PayloadAction<number>) {
      state.codePanelHeight = Math.max(CODE_PANEL_MIN_PX, action.payload)
      if (typeof window !== 'undefined') {
        localStorage.setItem('codePanelHeight', String(state.codePanelHeight))
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
  setTaskDescription,
  setTaskStatus,
  toggleChat,
  toggleSim,
  toggleCode,
  setSaving,
  setDiscarding,
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
  setRobotPanelWidth,
  setCodePanelHeight,
} = taskSlice.actions

export const taskReducers = taskSlice.reducer
