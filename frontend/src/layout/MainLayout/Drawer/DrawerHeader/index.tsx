import React from 'react'
import { useTheme } from '@mui/material/styles'
import { Stack, Box } from '@mui/material'

import { LogoSection } from 'components/Logo'

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
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', mt: '0.5rem' }}
      >
        <LogoSection />
        {/*         <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Chip
            label={`C-${packageInfo.version}`}
            size="small"
            title={`Client version ${packageInfo.version}`}
            sx={{
              height: 16,
              marginBottom: '0.2rem',
              '& .MuiChip-label': {
                fontSize: '0.625rem',
                py: 0.25,
              },
            }}
            component="div"
          />
          <Chip
            label={`S-${getFromLocalStorage(LocalStorageKey.USER)?.versionServer}`}
            title={`Server version ${getFromLocalStorage(LocalStorageKey.USER)?.versionServer}`}
            size="small"
            sx={{
              height: 16,
              '& .MuiChip-label': { fontSize: '0.625rem', py: 0.25 },
            }}
            component="div"
          />
        </div> */}
      </Stack>
    </Box>
  )
}
