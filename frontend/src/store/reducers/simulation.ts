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
  // Mode-neutral — 'Simulation not started' read wrong once executionTarget
  // is 'real' (nothing being simulated on the real robot). The reducers
  // below pick target-specific wording once a target is actually known.
  message: 'Not started',
  executionTarget: null,
}

export const simulationSlice = createSlice({
  name: 'simulation',
  initialState,
  reducers: {
    startSimulation(state, action: PayloadAction<'sim' | 'real'>) {
      state.isRunning = true
      state.progress = 0
      state.message =
        action.payload === 'real' ? 'Starting run...' : 'Starting simulation...'
      state.executionTarget = action.payload
    },
    stopSimulation(state) {
      state.isRunning = false
      state.progress = 0
      state.message =
        state.executionTarget === 'real' ? 'Run stopped' : 'Simulation stopped'
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
      state.message =
        state.executionTarget === 'real'
          ? UI_TEXT.taskCompletedOnRobot
          : UI_TEXT.simulationCompleted
    },
    setSimulationError(state, action: PayloadAction<string>) {
      state.isRunning = false
      state.progress = 0
      state.message = action.payload
    },
    // This slice is a single global instance, not scoped per task —
    // without an explicit reset, navigating away mid-run and opening a
    // different task inherits isRunning/message from whatever ran last.
    // Dispatched by task-workspace's per-visit re-sync, same pattern as
    // simOpen/lastSaved in store/reducers/task.ts.
    resetSimulation() {
      return initialState
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
  resetSimulation,
} = simulationSlice.actions
export const simulationReducers = simulationSlice.reducer
