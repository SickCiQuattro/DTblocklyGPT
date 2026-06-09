import React from 'react'
import { Box, Divider, Typography, Stack, CircularProgress, IconButton, Button } from '@mui/material'
import { PlayCircle, StopCircle, X, Terminal } from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'

import { useAppSelector } from 'store/reducers'
import { toggleSim } from 'store/reducers/task'
import { endpoints } from 'services/endpoints'
import { MethodHTTP, fetchApi } from 'services/api'
import {
  startSimulation as startSimAction,
  stopSimulation as stopSimAction,
  setSimulationCompleted,
  setSimulationError,
} from 'store/reducers/simulation'

interface DigitalTwinPanelProps {
  taskId: string
}

export const DigitalTwinPanel: React.FC<DigitalTwinPanelProps> = ({ taskId }) => {
  const dispatch = useDispatch()
  const simulation = useSelector((state: any) => state.simulation)
  const simOpen = useAppSelector((state) => state.task.simOpen)

  const startSimulation = async () => {
    if (!taskId) return
    dispatch(startSimAction())
    try {
      await fetchApi({
        url: endpoints.task.simulate,
        method: MethodHTTP.POST,
        body: {
          id: Number(taskId),
          simulateEvent: true,
        },
      })
      dispatch(setSimulationCompleted())
    } catch (error: any) {
      console.error('Error starting simulation:', error)
      dispatch(setSimulationError(error?.message || 'Error starting simulation'))
    }
  }

  const stopSimulation = () => {
    dispatch(stopSimAction())
  }

  const handleClose = () => {
    dispatch(toggleSim())
  }

  return (
    <Box
      sx={{
        position: 'fixed',
        right: 0,
        top: 'var(--layout-appbar-height, 56px)',
        bottom: 'var(--layout-statusbar-height, 40px)',
        width: '35vw',
        zIndex: 100,
        background: 'rgba(26, 26, 46, 0.95)',
        backdropFilter: 'blur(20px)',
        borderLeft: '1px solid rgba(99, 102, 241, 0.15)',
        boxShadow: '-10px 0 40px rgba(0, 0, 0, 0.3)',
        transform: simOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        color: '#E2E8F0',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 20px',
          background: 'rgba(255, 255, 255, 0.02)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        <Typography
          sx={{
            fontWeight: 600,
            fontSize: '1rem',
            letterSpacing: '-0.01em',
            color: '#FFFFFF',
          }}
        >
          Digital Twin Simulation
        </Typography>
        <IconButton
          onClick={handleClose}
          size="small"
          sx={{
            color: 'rgba(255, 255, 255, 0.45)',
            '&:hover': {
              color: '#FFFFFF',
              background: 'rgba(255, 255, 255, 0.08)',
            },
          }}
        >
          <X size={18} />
        </IconButton>
      </Box>

      <Box
        sx={{
          flex: 1,
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          overflowY: 'auto',
        }}
      >
        {/* Status Area */}
        <Box
          sx={{
            padding: '12px 16px',
            background: 'rgba(255, 255, 255, 0.03)',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          <Typography
            sx={{
              fontFamily: "'Geist Mono', monospace",
              fontSize: '0.74rem',
              color: '#94A3B8',
              marginBottom: '4px',
            }}
          >
            SYSTEM STATUS
          </Typography>
          <Typography
            sx={{
              fontWeight: 500,
              fontSize: '0.875rem',
              color: simulation.isRunning ? '#6366F1' : '#94A3B8',
            }}
          >
            {simulation.message}
          </Typography>
        </Box>

        {/* Progress Bar */}
        {simulation.isRunning && (
          <Box>
            <Stack
              direction="row"
              sx={{
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CircularProgress size={14} sx={{ color: '#6366F1' }} />
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 600 }}>
                  ROS2 Executor Progress
                </Typography>
              </Box>
              <Typography sx={{ fontSize: '0.75rem', color: '#6366F1' }}>
                {simulation.progress}%
              </Typography>
            </Stack>
            <Box
              sx={{
                height: '6px',
                background: 'rgba(255, 255, 255, 0.08)',
                borderRadius: '3px',
                overflow: 'hidden',
              }}
            >
              <Box
                style={{
                  width: `${simulation.progress}%`,
                  height: '100%',
                  background: '#6366F1',
                  transition: 'width 0.3s ease',
                }}
              />
            </Box>
          </Box>
        )}

        {/* Premium Digital Twin Simulation Frame */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.2)',
            border: '1px dashed rgba(255, 255, 255, 0.12)',
            borderRadius: '12px',
            padding: '24px',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {simulation.isRunning ? (
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(99, 102, 241, 0.03)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <CircularProgress size={32} sx={{ color: '#6366F1' }} />
              <Typography variant="body2" sx={{ color: '#94A3B8' }}>
                Rendering Gazebo ROS2 Simulation Workspace...
              </Typography>
            </Box>
          ) : (
            <Stack spacing={1} direction="column" sx={{ alignItems: 'center' }}>
              <Terminal size={32} style={{ color: '#6366F1', opacity: 0.8 }} />
              <Typography sx={{ fontSize: '0.9rem', fontWeight: 600 }}>
                WSL Gazebo / WebGL Active
              </Typography>
              <Typography sx={{ fontSize: '0.75rem', color: '#64748B' }}>
                Simulation pipeline initialized. Ready to execute code blocks.
              </Typography>
            </Stack>
          )}
        </Box>

        {/* Simulation Controls */}
        <Stack direction="row" spacing={2} sx={{ justifyContent: 'center' }}>
          <Button
            onClick={startSimulation}
            disabled={simulation.isRunning}
            variant="contained"
            color="primary"
            startIcon={<PlayCircle size={16} />}
            sx={{
              flex: 1,
              borderRadius: '8px',
              textTransform: 'none',
              fontWeight: 500,
              boxShadow: 'none',
              '&:hover': { boxShadow: 'none' },
            }}
          >
            Start
          </Button>
          <Button
            onClick={stopSimulation}
            disabled={!simulation.isRunning}
            variant="contained"
            color="error"
            startIcon={<StopCircle size={16} />}
            sx={{
              flex: 1,
              borderRadius: '8px',
              textTransform: 'none',
              fontWeight: 500,
              boxShadow: 'none',
              '&:hover': { boxShadow: 'none' },
            }}
          >
            Stop
          </Button>
        </Stack>
      </Box>
    </Box>
  )
}