import { combineReducers } from '@reduxjs/toolkit'
import { useSelector, TypedUseSelectorHook } from 'react-redux'

import { menuReducers, MenuState } from './menu'
import { taskReducers, TaskState } from './task'
import { proposalReducers, ProposalState } from './proposal'
import { simulationReducers, SimulationState } from './simulation'

export interface RootState {
  menu: MenuState
  task: TaskState
  proposal: ProposalState
  simulation: SimulationState
}

export const rootReducer = combineReducers({
  menu: menuReducers,
  task: taskReducers,
  proposal: proposalReducers,
  simulation: simulationReducers,
})

export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
