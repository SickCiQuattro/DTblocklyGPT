import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface SimulationState {
  isRunning: boolean
  progress: number // 0-100
  message: string
}

export const initialState: SimulationState = {
  isRunning: false,
  progress: 0,
  message: 'Simulation not started',
}

export const simulationSlice = createSlice({
  name: 'simulation',
  initialState,
  reducers: {
    startSimulation(state) {
      state.isRunning = true
      state.progress = 0
      state.message = 'Starting simulation...'
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
      state.message = 'Simulation completed'
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
