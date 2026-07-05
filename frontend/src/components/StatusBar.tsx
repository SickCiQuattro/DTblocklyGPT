import React from 'react'
import { Box, Typography, Button } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import { useDispatch } from 'react-redux'
import { Code } from 'lucide-react'

import { useAppSelector } from 'store/reducers'
import { toggleCode } from 'store/reducers/task'

export const StatusBar: React.FC = () => {
  const theme = useTheme()
  const dispatch = useDispatch()
  const lastSaved = useAppSelector((state) => state.task.lastSaved)
  const codeOpen = useAppSelector((state) => state.task.codeOpen)
  const isSimulationRunning = useAppSelector(
    (state) => state.simulation.isRunning,
  )

  return (
    <Box
      sx={{
        height: '40px',
        minHeight: '40px',
        bgcolor: 'background.default',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        fontFamily: "'Geist Mono', monospace",
        color: theme.palette.text.secondary,
        zIndex: 10,
        boxSizing: 'border-box',
      }}
    >
      {/* Left side: Simulation status */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: isSimulationRunning
              ? theme.palette.success.main
              : theme.palette.text.disabled,
            display: 'inline-block',
          }}
        />
        <Typography
          sx={{
            fontFamily: 'inherit',
            fontSize: '0.74rem',
            fontWeight: 500,
          }}
        >
          {isSimulationRunning ? 'Simulation running' : 'Simulation idle'}
        </Typography>
      </Box>

      {/* Center: Last saved timestamp */}
      <Box>
        <Typography
          sx={{
            fontFamily: 'inherit',
            fontSize: '0.74rem',
            fontWeight: 500,
          }}
        >
          {lastSaved ? `Saved at ${lastSaved}` : 'Draft not saved'}
        </Typography>
      </Box>

      {/* Right side: View Code toggle */}
      <Box>
        <Button
          onClick={() => dispatch(toggleCode())}
          size="small"
          startIcon={<Code size={14} />}
          sx={{
            fontFamily: "'Geist Mono', monospace",
            fontSize: '0.74rem',
            textTransform: 'none',
            fontWeight: 500,
            color: codeOpen ? 'primary.main' : 'inherit',
            minWidth: 0,
            padding: '2px 8px',
            '&:hover': {
              bgcolor: alpha(theme.palette.primary.main, 0.04),
            },
          }}
        >
          {codeOpen ? 'Hide Code' : 'View Code'}
        </Button>
      </Box>
    </Box>
  )
}
