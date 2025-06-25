import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Provider as ReduxProvider } from 'react-redux'
// import { LocalizationProvider } from '@mui/x-date-pickers'
// import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { SWRConfig } from 'swr'
import { ConfigProvider } from 'antd'
import enGB from 'antd/locale/en_GB'
import 'dayjs/locale/en-gb'
import 'antd/dist/reset.css'

import { locale } from 'dayjs'
import { swrParams } from 'services/api'
import { ToastContainerStyled } from 'components/ToastContainer'
import ThemeCustomization from 'themes'
import { Routes } from 'routes'
import { antdTheme } from 'themes/theme'
import { store } from './store'
import 'regenerator-runtime'
import '@ant-design/v5-patch-for-react-19'

locale('en-gb')

const container = document.getElementById('root') as HTMLElement
const root = createRoot(container)

root.render(
  <ReduxProvider store={store}>
    <BrowserRouter>
      <SWRConfig value={swrParams}>
        <ConfigProvider locale={enGB} theme={antdTheme}>
          {/* <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="en"> */}
          <ThemeCustomization>
            <Routes />
          </ThemeCustomization>
          <ToastContainerStyled />
          {/* </LocalizationProvider> */}
        </ConfigProvider>
      </SWRConfig>
    </BrowserRouter>
  </ReduxProvider>,
)
