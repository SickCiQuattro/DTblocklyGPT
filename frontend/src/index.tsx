import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Provider as ReduxProvider } from 'react-redux'
// import { LocalizationProvider } from '@mui/x-date-pickers'
// import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { SWRConfig } from 'swr'
import { locale } from 'dayjs'
import 'dayjs/locale/en-gb'

import { swrParams } from 'services/api'
import { ToastContainerStyled } from 'components/ToastContainer'
import ThemeCustomization from 'themes'
import { Routes } from 'routes'

import { store } from './store'
import 'regenerator-runtime'

locale('en-gb')

const container = document.getElementById('root') as HTMLElement
const root = createRoot(container)

root.render(
  <ReduxProvider store={store}>
    <BrowserRouter>
      <SWRConfig value={swrParams}>
        {/* <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="en"> */}
        <ThemeCustomization>
          <Routes />
        </ThemeCustomization>
        <ToastContainerStyled />
        {/* </LocalizationProvider> */}
      </SWRConfig>
    </BrowserRouter>
  </ReduxProvider>,
)
