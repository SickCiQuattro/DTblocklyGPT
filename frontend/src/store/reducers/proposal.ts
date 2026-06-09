import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface MessagePart {
  type: 'text' | 'warning'
  content: string
}

export interface ProposalState {
  proposedTask: any[] | null // AbstractStep[] from backend, we'll use any for now and replace with proper type if needed
  validationWarnings: string[]
  answer: string
}

export const initialState: ProposalState = {
  proposedTask: null,
  validationWarnings: [],
  answer: '',
}

export const proposalSlice = createSlice({
  name: 'proposal',
  initialState,
  reducers: {
    setProposedTask(
      state,
      action: PayloadAction<{
        proposedTask: any[] | null
        validationWarnings: string[]
        answer: string
      }>,
    ) {
      state.proposedTask = action.payload.proposedTask
      state.validationWarnings = action.payload.validationWarnings
      state.answer = action.payload.answer
    },
    clearProposedTask(state) {
      state.proposedTask = null
      state.validationWarnings = []
      state.answer = ''
    },
  },
})

export const { setProposedTask, clearProposedTask } = proposalSlice.actions
export const proposalReducers = proposalSlice.reducer
