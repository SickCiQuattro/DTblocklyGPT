import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Provider as ReduxProvider } from 'react-redux'
import { SWRConfig } from 'swr'
import { locale } from 'dayjs'
import 'dayjs/locale/en-gb'

import { swrParams } from 'services/api'
import { ToastContainerStyled } from 'components/ToastContainer'
import ThemeCustomization from 'themes'
import { Routes } from 'routes'

import { store } from './store'

// ─── Geist font — Vercel OSS, 2023 (design system primary font) ──────────────
// Self-hosted via @fontsource, not the render-blocking Google Fonts @import
// global.css used to also carry — that was loading Geist twice.
import '@fontsource/geist/400.css'
import '@fontsource/geist/500.css'
import '@fontsource/geist/600.css'
import '@fontsource/geist/700.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import '@fontsource/geist-mono/600.css'
import '@fontsource/geist-mono/700.css'

locale('en-gb')

const container = document.getElementById('root') as HTMLElement
const root = createRoot(container)

root.render(
  <ReduxProvider store={store}>
    <BrowserRouter>
      <SWRConfig value={swrParams}>
        <ThemeCustomization>
          <Routes />
        </ThemeCustomization>
        <ToastContainerStyled />
      </SWRConfig>
    </BrowserRouter>
  </ReduxProvider>,
)
