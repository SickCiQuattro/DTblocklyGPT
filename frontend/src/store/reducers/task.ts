import { createSlice } from '@reduxjs/toolkit'
import { INITIAL_TASK_STRUCTURE, TaskChatStructure } from 'pages/chat/utils'

export type TaskState = {
  task: TaskChatStructure
  editMode: boolean
}

export const initialState: TaskState = {
  task: INITIAL_TASK_STRUCTURE,
  editMode: false,
}

const taskSlice = createSlice({
  name: 'task',
  initialState,
  reducers: {
    updateTask(state, action) {
      return {
        ...state,
        task: action.payload,
      }
    },
    resetTask() {
      return initialState
    },
    toggleEditMode(state) {
      return {
        ...state,
        editMode: !state.editMode,
      }
    },
  },
})

export const { toggleEditMode, resetTask, updateTask } = taskSlice.actions
export const taskReducers = taskSlice.reducer
