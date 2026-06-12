import React, { useState, useEffect } from 'react'
import {
  Box,
  Typography,
  Stack,
  CircularProgress,
  IconButton,
  Button,
  Switch,
  Tooltip,
} from '@mui/material'
import {
  PlayCircle,
  StopCircle,
  X,
  Camera,
  Hand,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Wifi,
  WifiOff,
} from 'lucide-react'
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
import { useRosEvents } from 'hooks/useRosEvents'

const MJPEG_URL = '/camera/stream?topic=/camera/image_raw&type=mjpeg'

interface DigitalTwinPanelProps {
  taskId: string
}

export const DigitalTwinPanel: React.FC<DigitalTwinPanelProps> = ({
  taskId,
}) => {
  const dispatch = useDispatch()
  const simulation = useSelector((state: any) => state.simulation)
  const simOpen = useAppSelector((state) => state.task.simOpen)

  const [liveEvents, setLiveEvents] = useState(false)
  const [stepCompleted, setStepCompleted] = useState(false)

  const { gesture, objectDetection, humanStep, connected } = useRosEvents()

  // Brief "completed" flash before clearing overlay
  useEffect(() => {
    if (humanStep?.status !== 'completed') return
    setStepCompleted(true)
    const t = setTimeout(() => setStepCompleted(false), 2000)
    return () => clearTimeout(t)
  }, [humanStep])

  const startSimulation = async () => {
    if (!taskId) return
    dispatch(startSimAction())
    try {
      await fetchApi({
        url: endpoints.task.simulate,
        method: MethodHTTP.POST,
        body: {
          id: Number(taskId),
          simulateEvent: !liveEvents,
        },
      })
      dispatch(setSimulationCompleted())
    } catch (error: any) {
      console.error('Error starting simulation:', error)
      dispatch(
        setSimulationError(error?.message || 'Error starting simulation'),
      )
    }
  }

  const stopSimulation = () => {
    dispatch(stopSimAction())
  }

  const handleClose = () => {
    dispatch(toggleSim())
  }

  const isHumanStepActive =
    humanStep?.status === 'started' && simulation.isRunning
  const isTimeout = humanStep?.status === 'timeout'
  const gestureActive = gesture !== 'NONE' && gesture !== ''

  return (
    <Box
      sx={{
        position: 'fixed',
        right: 0,
        top: 'var(--layout-appbar-height, 56px)',
        bottom: 'var(--layout-statusbar-height, 40px)',
        width: '35vw',
        zIndex: 100,
        background: 'rgba(12, 12, 28, 0.97)',
        backdropFilter: 'blur(24px)',
        borderLeft: '1px solid rgba(99, 102, 241, 0.2)',
        boxShadow: '-16px 0 48px rgba(0, 0, 0, 0.4)',
        transform: simOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        color: '#E2E8F0',
      }}
    >
      {/* ── Header ── */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 18px',
          background: 'rgba(255,255,255,0.02)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}
      >
        <Stack direction="row" sx={{ alignItems: 'center' }} spacing={1.5}>
          <Camera size={16} color="#6366F1" />
          <Typography sx={{ fontWeight: 600, fontSize: '0.9rem', letterSpacing: '-0.01em' }}>
            Digital Twin
          </Typography>
          <Tooltip title={connected ? 'SocketIO connected' : 'SocketIO disconnected'}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {connected
                ? <Wifi size={13} color="#22C55E" />
                : <WifiOff size={13} color="#64748B" />}
            </Box>
          </Tooltip>
        </Stack>
        <IconButton
          onClick={handleClose}
          size="small"
          sx={{
            color: 'rgba(255,255,255,0.4)',
            '&:hover': { color: '#fff', background: 'rgba(255,255,255,0.07)' },
          }}
        >
          <X size={16} />
        </IconButton>
      </Box>

      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          padding: '16px',
          overflowY: 'auto',
        }}
      >
        {/* ── Timeout warning ── */}
        {isTimeout && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 14px',
              background: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: '8px',
            }}
          >
            <AlertTriangle size={15} color="#F59E0B" />
            <Typography sx={{ fontSize: '0.78rem', color: '#FCD34D' }}>
              Timeout: {humanStep?.condition === 'gesture'
                ? `gesture "${humanStep?.value}" not detected`
                : `object "${humanStep?.value}" not detected`}
              {' '}— simulation continued
            </Typography>
          </Box>
        )}

        {/* ── MJPEG stream + overlays ── */}
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            aspectRatio: '4/3',
            background: '#000',
            borderRadius: '10px',
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.08)',
            flexShrink: 0,
          }}
        >
          {simulation.isRunning ? (
            <img
              src={MJPEG_URL}
              alt="Gazebo camera feed"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          ) : (
            <Box
              sx={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1.5,
                background: 'rgba(0,0,0,0.6)',
              }}
            >
              <Camera size={28} color="#334155" />
              <Typography sx={{ fontSize: '0.78rem', color: '#475569' }}>
                Start simulation to stream Gazebo feed
              </Typography>
            </Box>
          )}

          {/* Human step overlay */}
          {isHumanStepActive && (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(12, 12, 28, 0.75)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                padding: '20px',
                animation: 'fadeIn 0.25s ease',
                '@keyframes fadeIn': { from: { opacity: 0 }, to: { opacity: 1 } },
              }}
            >
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: 'rgba(99, 102, 241, 0.15)',
                  border: '2px solid rgba(99, 102, 241, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Hand size={22} color="#818CF8" />
              </Box>
              <Typography
                sx={{
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  textAlign: 'center',
                  color: '#E2E8F0',
                  lineHeight: 1.4,
                }}
              >
                {humanStep?.description || 'Human action required'}
              </Typography>
              {humanStep?.description && (
                <Stack direction="row" sx={{ alignItems: 'center' }} spacing={0.8}>
                  <CircularProgress size={10} sx={{ color: '#6366F1' }} />
                  <Typography sx={{ fontSize: '0.72rem', color: '#94A3B8' }}>
                    Waiting for operator...
                  </Typography>
                </Stack>
              )}
            </Box>
          )}

          {/* Step completed flash */}
          {stepCompleted && (
            <Box
              sx={{
                position: 'absolute',
                top: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: 0.8,
                padding: '6px 14px',
                background: 'rgba(34, 197, 94, 0.15)',
                border: '1px solid rgba(34, 197, 94, 0.4)',
                borderRadius: '20px',
                backdropFilter: 'blur(8px)',
              }}
            >
              <CheckCircle2 size={13} color="#22C55E" />
              <Typography sx={{ fontSize: '0.72rem', color: '#86EFAC', fontWeight: 500 }}>
                Step completed
              </Typography>
            </Box>
          )}
        </Box>

        {/* ── Event status strip ── */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '10px',
          }}
        >
          {/* Gesture badge */}
          <Box
            sx={{
              padding: '10px 12px',
              background: gestureActive
                ? 'rgba(99, 102, 241, 0.1)'
                : 'rgba(255,255,255,0.03)',
              border: gestureActive
                ? '1px solid rgba(99, 102, 241, 0.35)'
                : '1px solid rgba(255,255,255,0.07)',
              borderRadius: '8px',
              transition: 'all 0.2s ease',
            }}
          >
            <Typography
              sx={{
                fontSize: '0.66rem',
                color: '#64748B',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: '5px',
              }}
            >
              Gesture
            </Typography>
            <Stack direction="row" sx={{ alignItems: 'center' }} spacing={0.8}>
              <Hand size={13} color={gestureActive ? '#818CF8' : '#475569'} />
              <Typography
                sx={{
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: gestureActive ? '#A5B4FC' : '#475569',
                  fontFamily: "'Geist Mono', monospace",
                }}
              >
                {gesture || 'NONE'}
              </Typography>
            </Stack>
          </Box>

          {/* Object detection badge */}
          <Box
            sx={{
              padding: '10px 12px',
              background: objectDetection.detected
                ? 'rgba(34, 197, 94, 0.08)'
                : 'rgba(255,255,255,0.03)',
              border: objectDetection.detected
                ? '1px solid rgba(34, 197, 94, 0.3)'
                : '1px solid rgba(255,255,255,0.07)',
              borderRadius: '8px',
              transition: 'all 0.2s ease',
            }}
          >
            <Typography
              sx={{
                fontSize: '0.66rem',
                color: '#64748B',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: '5px',
              }}
            >
              Objects
            </Typography>
            <Stack direction="row" sx={{ alignItems: 'center' }} spacing={0.8}>
              <Eye size={13} color={objectDetection.detected ? '#22C55E' : '#475569'} />
              <Typography
                sx={{
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: objectDetection.detected ? '#86EFAC' : '#475569',
                  fontFamily: "'Geist Mono', monospace",
                }}
              >
                {objectDetection.detected
                  ? objectDetection.detections
                      .slice(0, 2)
                      .map((d) => d.class)
                      .join(', ')
                  : 'none'}
              </Typography>
            </Stack>
          </Box>
        </Box>

        {/* ── System status ── */}
        <Box
          sx={{
            padding: '10px 14px',
            background: 'rgba(255,255,255,0.02)',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <Typography
            sx={{
              fontFamily: "'Geist Mono', monospace",
              fontSize: '0.68rem',
              color: '#475569',
              marginBottom: '3px',
              letterSpacing: '0.05em',
            }}
          >
            STATUS
          </Typography>
          <Stack direction="row" sx={{ alignItems: 'center' }} spacing={1}>
            {simulation.isRunning && (
              <CircularProgress size={11} sx={{ color: '#6366F1' }} />
            )}
            <Typography
              sx={{
                fontSize: '0.8rem',
                fontWeight: 500,
                color: simulation.isRunning ? '#818CF8' : '#64748B',
              }}
            >
              {simulation.message}
            </Typography>
          </Stack>
        </Box>

        {/* ── Mode toggle ── */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 14px',
            background: 'rgba(255,255,255,0.02)',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <Typography sx={{ fontSize: '0.78rem', color: '#94A3B8' }}>
            Live vision events
          </Typography>
          <Tooltip
            title={
              liveEvents
                ? 'Webcam active — gesture & object detection block execution'
                : 'Simulated — all events auto-fulfilled'
            }
          >
            <Switch
              size="small"
              checked={liveEvents}
              onChange={(e) => setLiveEvents(e.target.checked)}
              disabled={simulation.isRunning}
              sx={{
                '& .MuiSwitch-switchBase.Mui-checked': { color: '#6366F1' },
                '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                  backgroundColor: '#6366F1',
                },
              }}
            />
          </Tooltip>
        </Box>

        {/* ── Controls ── */}
        <Stack direction="row" spacing={1.5}>
          <Button
            onClick={startSimulation}
            disabled={simulation.isRunning}
            variant="contained"
            startIcon={<PlayCircle size={15} />}
            sx={{
              flex: 1,
              borderRadius: '8px',
              textTransform: 'none',
              fontWeight: 500,
              fontSize: '0.82rem',
              background: '#6366F1',
              boxShadow: 'none',
              '&:hover': { background: '#4F46E5', boxShadow: 'none' },
              '&.Mui-disabled': { background: 'rgba(99,102,241,0.2)', color: 'rgba(255,255,255,0.3)' },
            }}
          >
            {liveEvents ? 'Start Live' : 'Start'}
          </Button>
          <Button
            onClick={stopSimulation}
            disabled={!simulation.isRunning}
            variant="outlined"
            startIcon={<StopCircle size={15} />}
            sx={{
              flex: 1,
              borderRadius: '8px',
              textTransform: 'none',
              fontWeight: 500,
              fontSize: '0.82rem',
              borderColor: 'rgba(239,68,68,0.4)',
              color: '#F87171',
              boxShadow: 'none',
              '&:hover': { borderColor: '#EF4444', background: 'rgba(239,68,68,0.08)', boxShadow: 'none' },
              '&.Mui-disabled': { borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.2)' },
            }}
          >
            Stop
          </Button>
        </Stack>
      </Box>
    </Box>
  )
}
