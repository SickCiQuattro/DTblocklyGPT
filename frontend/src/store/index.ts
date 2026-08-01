import { configureStore } from '@reduxjs/toolkit'

import { isDevelopment } from 'utils/constants'

import { rootReducer } from './reducers'

export const store = configureStore({
  reducer: rootReducer,
  devTools: isDevelopment,
})
