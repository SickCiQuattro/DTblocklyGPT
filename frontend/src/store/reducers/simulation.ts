import { createSlice, PayloadAction } from '@reduxjs/toolkit'

import { UI_TEXT } from 'constants/uiVocabulary'

export interface SimulationState {
  isRunning: boolean
  progress: number // 0-100
  message: string
  // Which target the last/current run is for — lets sibling components
  // (StatusBar) distinguish "Simulation running" from "Robot running"
  // without each needing its own copy of DigitalTwinPanel's local state.
  executionTarget: 'sim' | 'real' | null
}

export const initialState: SimulationState = {
  isRunning: false,
  progress: 0,
  message: 'Simulation not started',
  executionTarget: null,
}

export const simulationSlice = createSlice({
  name: 'simulation',
  initialState,
  reducers: {
    startSimulation(state, action: PayloadAction<'sim' | 'real'>) {
      state.isRunning = true
      state.progress = 0
      state.message = 'Starting simulation...'
      state.executionTarget = action.payload
    },
    stopSimulation(state) {
      state.isRunning = false
      state.progress = 0
      state.message = 'Simulation stopped'
    },
    setSimulationProgress(
      state,
      action: PayloadAction<{ progress: number; message?: string }>,
    ) {
      state.progress = action.payload.progress
      if (action.payload.message) {
        state.message = action.payload.message
      }
    },
    setSimulationMessage(state, action: PayloadAction<string>) {
      state.message = action.payload
    },
    setSimulationCompleted(state) {
      state.isRunning = false
      state.progress = 100
      state.message = UI_TEXT.simulationCompleted
    },
    setSimulationError(state, action: PayloadAction<string>) {
      state.isRunning = false
      state.progress = 0
      state.message = action.payload
    },
  },
})

export const {
  startSimulation,
  stopSimulation,
  setSimulationProgress,
  setSimulationMessage,
  setSimulationCompleted,
  setSimulationError,
} = simulationSlice.actions
export const simulationReducers = simulationSlice.reducer
