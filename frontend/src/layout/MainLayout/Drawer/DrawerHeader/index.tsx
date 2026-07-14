import React from 'react'
import { useTheme } from '@mui/material/styles'
import { Box, ButtonBase, IconButton, Tooltip } from '@mui/material'
import { PanelLeft } from 'lucide-react'

import { LogoSection } from 'components/Logo'

interface DrawerHeaderProps {
  open: boolean
  handleDrawerToggle?: () => void
}

export const DrawerHeader = ({
  open,
  handleDrawerToggle,
}: DrawerHeaderProps) => {
  const theme = useTheme()

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: open ? 'space-between' : 'flex-start',
        height: '56px',
        width: '100%',
        pl: '14px',
        pr: open ? '8px' : '14px',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {open || !handleDrawerToggle ? (
        <LogoSection open={open} />
      ) : (
        <Tooltip title="Expand sidebar" placement="right">
          <ButtonBase
            disableRipple
            onClick={handleDrawerToggle}
            sx={{ display: 'flex', alignItems: 'center', borderRadius: 1 }}
          >
            <LogoSection open={open} />
          </ButtonBase>
        </Tooltip>
      )}
      {open && handleDrawerToggle && (
        <Tooltip title="Collapse sidebar" placement="right">
          <IconButton
            onClick={handleDrawerToggle}
            size="small"
            sx={{ color: 'primary.main' }}
          >
            <PanelLeft size={18} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  )
}
