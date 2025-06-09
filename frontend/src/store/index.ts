// import { createLogger } from 'redux-logger'
import { configureStore } from '@reduxjs/toolkit'

import { isDevelopment } from 'utils/constants'
import { rootReducer } from './reducers'

/* const loggerMiddleware = createLogger({
  collapsed: true,
  duration: true,
}) */

export const store = configureStore({
  reducer: rootReducer,
  devTools: isDevelopment,
  // middleware: isDevelopment ? [loggerMiddleware] : [],
})
