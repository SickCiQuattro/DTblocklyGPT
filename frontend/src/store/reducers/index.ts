import { combineReducers } from '@reduxjs/toolkit'
import { useSelector, TypedUseSelectorHook } from 'react-redux'

import { menuReducers, MenuState } from './menu'
import { taskReducers, TaskState } from './task'

export interface RootState {
  menu: MenuState
  task: TaskState
}

export const rootReducer = combineReducers({
  menu: menuReducers,
  task: taskReducers,
})

export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
