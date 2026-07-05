import React, { useMemo, ReactNode } from 'react'
import {
  CssBaseline,
  StyledEngineProvider,
  ThemeOptions,
  createTheme,
  ThemeProvider,
  Direction,
} from '@mui/material'
import { enUS } from '@mui/material/locale'

import { Palette } from './palette'
import { Typography } from './typography'
import { CustomShadows } from './shadows'
import { componentsOverrides } from './overrides'

interface ThemeCustomizationProps {
  children: ReactNode
}

const ThemeCustomization = ({ children }: ThemeCustomizationProps) => {
  const themePalette = Palette('light')
  const themeTypography = Typography(
    "'Geist', 'Inter', 'General Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  )
  const themeCustomShadows = useMemo(
    () => CustomShadows(themePalette),
    [themePalette],
  )

  const themeOptions: ThemeOptions = useMemo(
    () => ({
      breakpoints: { values: { xs: 0, sm: 768, md: 1024, lg: 1266, xl: 1536 } },
      direction: 'ltr',
      // minHeight matches LAYOUT.appBarHeight (utils/constants.ts) — the
      // actual rendered AppBar height. Was 60, a stale mismatch.
      mixins: { toolbar: { minHeight: 56, paddingTop: 8, paddingBottom: 8 } },
      // Base radius token. Scale: 4 small controls (Chip/IconButton pin their
      // own), 8 base (this value — buttons/inputs/menus), 12 dialogs/menus
      // (Dialog.ts override), 16 floating-shell panels (sx literals, one tier
      // up from shape so they read as "panel" not "control").
      shape: { borderRadius: 8 },
      palette: themePalette.palette,
      customShadows: themeCustomShadows,
      typography: themeTypography,
    }),
    [themePalette, themeTypography, themeCustomShadows],
  )

  const themes = createTheme(themeOptions, enUS)
  themes.components = componentsOverrides(themes)

  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={themes}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </StyledEngineProvider>
  )
}

export default ThemeCustomization
