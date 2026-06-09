import React from 'react'
import {
  Box,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Tooltip,
} from '@mui/material'
import { HelpCircle } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useTheme } from '@mui/material/styles'

import { SimpleBarScroll } from '../../../../components/SimpleBar'

import { Navigation } from './Navigation'

interface DrawerContentProps {
  open: boolean
}

export const DrawerContent = ({ open }: DrawerContentProps) => {
  const location = useLocation()
  const theme = useTheme()
  const isFaqActive = location.pathname === '/faq'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Scrollable navigation items */}
      <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
        <SimpleBarScroll
          sx={{
            height: '100%',
            '& .simplebar-content': {
              display: 'flex',
              flexDirection: 'column',
            },
          }}
        >
          <Navigation />
        </SimpleBarScroll>
      </Box>

      {/* Bottom FAQ button separated by a divider */}
      <Box
        sx={{
          p: 1,
          borderTop: `1px solid ${theme.palette.divider}`,
          bgcolor: 'background.paper',
        }}
      >
        <Tooltip
          title="Instructions & FAQ"
          placement="right"
          disableHoverListener={open}
        >
          <ListItemButton
            component={Link}
            to="/faq"
            selected={isFaqActive}
            onClick={(e) => {
              e.stopPropagation()
            }}
            sx={{
              borderRadius: '8px',
              mx: 1,
              my: 0.25,
              px: 1,
              py: 1,
              display: 'flex',
              justifyContent: 'flex-start',
              alignItems: 'center',
              position: 'relative',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              '&.Mui-selected': {
                bgcolor: 'rgba(99, 102, 241, 0.08)',
                color: 'primary.main',
                '&:hover': {
                  bgcolor: 'rgba(99, 102, 241, 0.08)',
                },
                // Sleek left-accent indicator bar (Design System)
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  left: 0,
                  top: '8px',
                  bottom: '8px',
                  width: '3px',
                  borderRadius: '0 4px 4px 0',
                  bgcolor: theme.palette.primary.main,
                },
              },
              '&:hover': {
                bgcolor: 'rgba(99, 102, 241, 0.04)',
              },
            }}
          >
            <ListItemIcon
              sx={{
                minWidth: '24px',
                mr: open ? '12px' : '0px',
                color: isFaqActive ? 'primary.main' : 'text.primary',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                transition: 'margin-right 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              <HelpCircle size={18} />
            </ListItemIcon>
            <ListItemText
              sx={{
                margin: 0,
                opacity: open ? 1 : 0,
                maxWidth: open ? '150px' : '0px',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                transition:
                  'opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), max-width 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
              primary={
                <Typography
                  variant="body2"
                  sx={{
                    color: isFaqActive ? 'primary.main' : 'text.primary',
                    fontWeight: 500,
                  }}
                >
                  Instructions & FAQ
                </Typography>
              }
            />
          </ListItemButton>
        </Tooltip>
      </Box>
    </Box>
  )
}
