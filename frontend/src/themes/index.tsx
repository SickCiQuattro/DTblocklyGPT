import React, { useMemo, ReactNode } from 'react'
import {
  CssBaseline,
  StyledEngineProvider,
  ThemeOptions,
  createTheme,
  ThemeProvider,
  Direction,
} from '@mui/material'
import { itIT } from '@mui/material/locale'

import { Palette } from './palette'
import { Typography } from './typography'
import { CustomShadows } from './shadows'
import { componentsOverrides } from './overrides'

interface ThemeCustomizationProps {
  children: ReactNode
}

const ThemeCustomization = ({ children }: ThemeCustomizationProps) => {
  const themePalette = Palette('light')
  const themeTypography = Typography(`'Public Sans', sans-serif`)
  const themeCustomShadows = useMemo(
    () => CustomShadows(themePalette),
    [themePalette],
  )

  const themeOptions: ThemeOptions = useMemo(
    () => ({
      breakpoints: { values: { xs: 0, sm: 768, md: 1024, lg: 1266, xl: 1536 } },
      direction: 'ltr' as Direction,
      mixins: { toolbar: { minHeight: 60, paddingTop: 8, paddingBottom: 8 } },
      palette: themePalette.palette,
      customShadows: themeCustomShadows,
      typography: themeTypography,
    }),
    [themePalette, themeTypography, themeCustomShadows],
  )

  const themes = createTheme(themeOptions, itIT)
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
