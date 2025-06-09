import React from 'react'
import { useTheme } from '@mui/material/styles'
import { Stack, Chip, Box } from '@mui/material'

import { LogoSection } from 'components/Logo'
import { LocalStorageKey, getFromLocalStorage } from 'utils/localStorageUtils'
import packageInfo from '../../../../../../package.json'

interface DrawerHeaderProps {
  open: boolean
}

export const DrawerHeader = ({ open }: DrawerHeaderProps) => {
  const theme = useTheme()

  return (
    <Box
      sx={{
        // ...theme.mixins.toolbar,
        display: 'flex',
        alignItems: 'center',
        justifyContent: open ? 'flex-start' : 'center',
        paddingLeft: theme.spacing(open ? 3 : 0),
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <LogoSection />
        <Chip
          label={packageInfo.version}
          size="small"
          title="BlocklyGPT version"
          sx={{
            height: 16,
            '& .MuiChip-label': { fontSize: '0.625rem', py: 0.25 },
          }}
          component="div"
        />
      </Stack>
    </Box>
  )
}
