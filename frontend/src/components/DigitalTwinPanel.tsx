import React, { useEffect, useRef, useState } from 'react'
import {
  Box,
  Typography,
  Stack,
  CircularProgress,
  IconButton,
  Button,
  Switch,
  Tooltip,
  LinearProgress,
  ToggleButton,
  ToggleButtonGroup,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material'
import {
  Play,
  Square,
  MonitorPlay,
  Cpu,
  X,
  Camera,
  Hand,
  Eye,
  Mic,
  AlertTriangle,
  CheckCircle2,
  Wifi,
  WifiOff,
  VideoOff,
  Bell,
} from 'lucide-react'
import useSWR from 'swr'
import { useDispatch, useSelector } from 'react-redux'

import { MyRobotType } from 'pages/myrobots/types'
import { TaskStatus } from 'pages/tasks/types'
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
import { useWebcamVision } from 'hooks/useWebcamVision'
import { useVoiceCommand } from 'hooks/useVoiceCommand'
import * as Blockly from 'blockly/core'
import {
  highlightExecutingBlock,
  clearExecutingHighlights,
} from 'features/blockly/utils/blockHighlight'
import { Theme as ThemeOption } from 'themes/theme'

// Digital Twin is an intentionally-dark monitoring panel (design spec §3.6/§3.8).
// Brand/semantic colors come from the design-system tokens; the slate chrome and
// accent-lights (which have no direct runtime token) are a deliberate local
// palette, kept dark on purpose.
const tokens = ThemeOption()
const C_PRIMARY = tokens.primary.main
const C_PRIMARY_DARK = tokens.primary.dark
const C_SUCCESS = tokens.success.main
const C_WARNING = tokens.warning.main
const C_WARNING_LIGHT = tokens.warning.light
const C_ERROR = tokens.error.main
const C_ERROR_LIGHT = tokens.error.light
const ACCENT_INDIGO_LIGHT = '#818CF8'
const ACCENT_INDIGO_FAINT = '#A5B4FC'
const ACCENT_GREEN_LIGHT = '#86EFAC'
const PANEL_BG = '#0c0c1c'
const PANEL_TEXT = '#E2E8F0'
const PANEL_TEXT_DIM = '#94A3B8'
const PANEL_MUTED = '#64748B'
const PANEL_FAINT = '#475569'
const PANEL_BORDER = '#334155'

const MJPEG_URL = '/camera/stream?topic=/camera/image_raw&type=mjpeg'

interface DigitalTwinPanelProps {
  taskId: string
  taskStatus?: TaskStatus
  /** Live editor workspace, used to highlight the block currently executing. */
  workspace?: Blockly.WorkspaceSvg | null
}

export const DigitalTwinPanel: React.FC<DigitalTwinPanelProps> = ({
  taskId,
  taskStatus,
  workspace,
}) => {
  const dispatch = useDispatch()
  const simulation = useSelector((state: any) => state.simulation)
  const simOpen = useAppSelector((state) => state.task.simOpen)

  const [liveEvents, setLiveEvents] = useState(false)
  const [stepCompleted, setStepCompleted] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [notifyBanner, setNotifyBanner] = useState<string | null>(null)
  const [executionTarget, setExecutionTarget] = useState<'sim' | 'real'>('sim')
  const [selectedRobot, setSelectedRobot] = useState<number | string>('')
  const [confirmRealRun, setConfirmRealRun] = useState(false)

  const { data: dataMyRobots } = useSWR<MyRobotType[], Error>({
    url: endpoints.home.libraries.myRobots,
  })

  const {
    gesture: rosGesture,
    objectDetection,
    humanStep,
    blockStep,
    connected,
  } = useRosEvents()
  const webcam = useWebcamVision()
  const voice = useVoiceCommand()

  // ── Live block-execution highlight ──────────────────────────────────────────
  // Per-step reaction: highlight the running block (+ its object/location),
  // clearing the previous one. No-ops if the simulated workspace differs from
  // the one on screen (getBlockById returns null).
  useEffect(() => {
    if (!workspace || !blockStep) return
    if (blockStep.phase === 'start') {
      clearExecutingHighlights(workspace)
      highlightExecutingBlock(workspace, blockStep.blockId)
    } else {
      clearExecutingHighlights(workspace)
    }
  }, [blockStep, workspace])

  // Safety-net cleanup when the run stops (the last block's `end` also clears).
  // Kept separate so `isRunning` isn't a dependency of the per-step effect.
  useEffect(() => {
    if (!simulation.isRunning && workspace) {
      clearExecutingHighlights(workspace)
    }
  }, [simulation.isRunning, workspace])

  // Prefer webcam gesture in live mode (lower latency than SocketIO roundtrip)
  const activeGesture =
    liveEvents && webcam.active ? webcam.gesture : rosGesture
  const activeDetections =
    liveEvents && webcam.active ? webcam.detections : objectDetection.detections

  // Start/stop webcam + voice recognition with the live toggle
  useEffect(() => {
    if (liveEvents) {
      webcam.start()
      voice.start()
    } else {
      webcam.stop()
      voice.stop()
    }
  }, [liveEvents]) // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown ticker
  useEffect(() => {
    if (humanStep?.status === 'started' && humanStep.timeout) {
      setCountdown(humanStep.timeout)
      if (countdownRef.current) clearInterval(countdownRef.current)
      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev === null || prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } else {
      if (countdownRef.current) clearInterval(countdownRef.current)
      setCountdown(null)
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [humanStep?.status, humanStep?.timeout])

  // Step completed flash
  useEffect(() => {
    if (humanStep?.status !== 'completed') return
    setStepCompleted(true)
    const t = setTimeout(() => setStepCompleted(false), 2000)
    return () => clearTimeout(t)
  }, [humanStep])

  // Notify banner (auto-dismisses)
  useEffect(() => {
    if (humanStep?.status !== 'notify') return
    setNotifyBanner(humanStep.description || 'Notification')
    const t = setTimeout(() => setNotifyBanner(null), 4000)
    return () => clearTimeout(t)
  }, [humanStep])

  const runSimulation = async () => {
    if (!taskId || !canRun) return
    dispatch(startSimAction())
    try {
      await fetchApi({
        url: endpoints.task.simulate,
        method: MethodHTTP.POST,
        body: { id: Number(taskId), simulateEvent: !liveEvents },
      })
      dispatch(setSimulationCompleted())
    } catch (error: any) {
      console.error('Error starting simulation:', error)
      dispatch(
        setSimulationError(error?.message || 'Error starting simulation'),
      )
    }
  }

  const runOnRobot = async () => {
    if (!taskId || !selectedRobot || !canRun) return
    dispatch(startSimAction())
    try {
      await fetchApi({
        url: endpoints.task.run,
        method: MethodHTTP.POST,
        body: {
          id: Number(taskId),
          robot: selectedRobot,
          sensorhuman: !liveEvents,
        },
      })
      dispatch(setSimulationCompleted())
    } catch (error: any) {
      console.error('Error running on robot:', error)
      dispatch(setSimulationError(error?.message || 'Error running on robot'))
    }
  }

  // Real-robot runs go through a confirm dialog (irreversible physical motion).
  const handleRun = () => {
    if (executionTarget === 'real') {
      setConfirmRealRun(true)
      return
    }
    runSimulation()
  }

  const confirmAndRun = () => {
    setConfirmRealRun(false)
    runOnRobot()
  }

  const stopSimulation = () => dispatch(stopSimAction())
  const handleClose = () => dispatch(toggleSim())

  // Only a fully published task can drive sim or robot. A task that is still a
  // draft — or published_with_draft (edits pending) — must not run, because the
  // runtime workspace would be the last published version and would not match
  // the draft on screen. Webcam/gesture testing stays available regardless.
  const canRun = taskStatus === 'published'

  const isHumanStepActive =
    humanStep?.status === 'started' && simulation.isRunning
  const isTimeout = humanStep?.status === 'timeout'
  const gestureActive = activeGesture !== 'NONE' && activeGesture !== ''
  const expectedGesture =
    isHumanStepActive && humanStep?.condition === 'gesture'
      ? humanStep.value
      : null
  const gestureMatch = !!(expectedGesture && activeGesture === expectedGesture)

  const timeoutTotal = humanStep?.timeout ?? 60
  const countdownPct = countdown !== null ? (countdown / timeoutTotal) * 100 : 0

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
        color: PANEL_TEXT,
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
          <Camera size={16} color={C_PRIMARY} />
          <Typography
            sx={{
              fontWeight: 600,
              fontSize: '0.9rem',
              letterSpacing: '-0.01em',
            }}
          >
            Digital Twin
          </Typography>
          <Tooltip
            title={connected ? 'SocketIO connected' : 'SocketIO disconnected'}
          >
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {connected ? (
                <Wifi size={13} color={C_SUCCESS} />
              ) : (
                <WifiOff size={13} color={PANEL_MUTED} />
              )}
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
          gap: '12px',
          padding: '14px 16px',
          overflowY: 'auto',
        }}
      >
        {/* ── Notify banner (transient) ── */}
        {notifyBanner && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 14px',
              background: 'rgba(99,102,241,0.1)',
              border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: '8px',
            }}
          >
            <Bell size={15} color={ACCENT_INDIGO_LIGHT} />
            <Typography
              sx={{ fontSize: '0.78rem', color: ACCENT_INDIGO_FAINT }}
            >
              {notifyBanner}
            </Typography>
          </Box>
        )}

        {/* ── Timeout warning ── */}
        {isTimeout && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 14px',
              background: 'rgba(245,158,11,0.12)',
              border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: '8px',
            }}
          >
            <AlertTriangle size={15} color={C_WARNING} />
            <Typography sx={{ fontSize: '0.78rem', color: C_WARNING_LIGHT }}>
              Timeout:{' '}
              {humanStep?.condition === 'gesture'
                ? `gesture "${humanStep?.value}" not detected`
                : `object "${humanStep?.value}" not detected`}{' '}
              — simulation continued
            </Typography>
          </Box>
        )}

        {/* ── Gazebo MJPEG stream ── */}
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
              }}
            >
              <Camera size={28} color={PANEL_BORDER} />
              <Typography sx={{ fontSize: '0.78rem', color: PANEL_FAINT }}>
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
                background: 'rgba(12,12,28,0.78)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1.5,
                padding: '20px',
                animation: 'fadeIn 0.25s ease',
                '@keyframes fadeIn': {
                  from: { opacity: 0 },
                  to: { opacity: 1 },
                },
              }}
            >
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: 'rgba(99,102,241,0.15)',
                  border: '2px solid rgba(99,102,241,0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Hand size={22} color={ACCENT_INDIGO_LIGHT} />
              </Box>
              <Typography
                sx={{
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  textAlign: 'center',
                  color: PANEL_TEXT,
                  lineHeight: 1.4,
                }}
              >
                {humanStep?.description || 'Human action required'}
              </Typography>
              <Stack
                direction="row"
                sx={{ alignItems: 'center' }}
                spacing={0.8}
              >
                <CircularProgress size={10} sx={{ color: C_PRIMARY }} />
                <Typography sx={{ fontSize: '0.72rem', color: PANEL_TEXT_DIM }}>
                  Waiting for operator...
                </Typography>
              </Stack>
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
                background: 'rgba(34,197,94,0.15)',
                border: '1px solid rgba(34,197,94,0.4)',
                borderRadius: '20px',
                backdropFilter: 'blur(8px)',
              }}
            >
              <CheckCircle2 size={13} color={C_SUCCESS} />
              <Typography
                sx={{
                  fontSize: '0.72rem',
                  color: ACCENT_GREEN_LIGHT,
                  fontWeight: 500,
                }}
              >
                Step completed
              </Typography>
            </Box>
          )}
        </Box>

        {/* ── Gesture state large — only when human step active and expecting gesture ── */}
        {isHumanStepActive && expectedGesture && (
          <Box
            sx={{
              padding: '14px 16px',
              background: gestureMatch
                ? 'rgba(34,197,94,0.1)'
                : 'rgba(99,102,241,0.07)',
              border: gestureMatch
                ? '1px solid rgba(34,197,94,0.35)'
                : '1px solid rgba(99,102,241,0.2)',
              borderRadius: '10px',
              transition: 'all 0.25s ease',
            }}
          >
            <Stack
              direction="row"
              sx={{
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                mb: 1,
              }}
            >
              <Box>
                <Typography
                  sx={{
                    fontSize: '0.62rem',
                    color: PANEL_MUTED,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase',
                    mb: 0.3,
                  }}
                >
                  Required
                </Typography>
                <Typography
                  sx={{
                    fontSize: '1.05rem',
                    fontWeight: 700,
                    fontFamily: "'Geist Mono', monospace",
                    color: gestureMatch
                      ? ACCENT_GREEN_LIGHT
                      : ACCENT_INDIGO_FAINT,
                    letterSpacing: '0.02em',
                  }}
                >
                  {expectedGesture}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography
                  sx={{
                    fontSize: '0.62rem',
                    color: PANEL_MUTED,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase',
                    mb: 0.3,
                  }}
                >
                  Detected
                </Typography>
                <Typography
                  sx={{
                    fontSize: '1.05rem',
                    fontWeight: 700,
                    fontFamily: "'Geist Mono', monospace",
                    color: gestureMatch
                      ? ACCENT_GREEN_LIGHT
                      : gestureActive
                        ? ACCENT_INDIGO_LIGHT
                        : PANEL_FAINT,
                  }}
                >
                  {activeGesture || 'NONE'}
                </Typography>
              </Box>
            </Stack>
            {countdown !== null && (
              <>
                <LinearProgress
                  variant="determinate"
                  value={countdownPct}
                  sx={{
                    height: 3,
                    borderRadius: 2,
                    mb: 0.5,
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    '& .MuiLinearProgress-bar': {
                      backgroundColor:
                        countdown < 10
                          ? C_ERROR
                          : countdown < 20
                            ? C_WARNING
                            : C_PRIMARY,
                      borderRadius: 2,
                    },
                  }}
                />
                <Typography
                  sx={{
                    fontSize: '0.68rem',
                    color: countdown < 10 ? C_ERROR_LIGHT : PANEL_MUTED,
                    textAlign: 'right',
                  }}
                >
                  {countdown}s
                </Typography>
              </>
            )}
          </Box>
        )}

        {/* ── Webcam preview (when live events ON) ── */}
        {liveEvents && (
          <Box
            sx={{
              position: 'relative',
              width: '100%',
              aspectRatio: '16/9',
              background: '#000',
              borderRadius: '10px',
              overflow: 'hidden',
              border: webcam.error
                ? '1px solid rgba(239,68,68,0.4)'
                : '1px solid rgba(255,255,255,0.08)',
              flexShrink: 0,
            }}
          >
            <video
              ref={webcam.attachVideo}
              autoPlay
              muted
              playsInline
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                transform: 'scaleX(-1)',
              }}
            />

            {!webcam.active && !webcam.error && (
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  gap: 1,
                }}
              >
                <CircularProgress size={20} sx={{ color: C_PRIMARY }} />
                <Typography sx={{ fontSize: '0.72rem', color: PANEL_TEXT_DIM }}>
                  Starting camera...
                </Typography>
              </Box>
            )}

            {webcam.error && (
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  gap: 1,
                  padding: '16px',
                }}
              >
                <VideoOff size={22} color={C_ERROR_LIGHT} />
                <Typography
                  sx={{
                    fontSize: '0.72rem',
                    color: C_ERROR_LIGHT,
                    textAlign: 'center',
                  }}
                >
                  {webcam.error}
                </Typography>
              </Box>
            )}

            {/* Gesture + object chips */}
            {webcam.active && (
              <Box
                sx={{
                  position: 'absolute',
                  bottom: 8,
                  left: 8,
                  right: 8,
                  display: 'flex',
                  gap: '6px',
                  flexWrap: 'wrap',
                }}
              >
                {webcam.gesture !== 'NONE' && (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      padding: '3px 8px',
                      background: 'rgba(99,102,241,0.85)',
                      borderRadius: '12px',
                      backdropFilter: 'blur(6px)',
                    }}
                  >
                    <Hand size={11} color="#fff" />
                    <Typography
                      sx={{
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        color: '#fff',
                        fontFamily: "'Geist Mono', monospace",
                      }}
                    >
                      {webcam.gesture}
                    </Typography>
                  </Box>
                )}
                {webcam.detections.slice(0, 3).map((d, i) => (
                  <Box
                    key={i}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      padding: '3px 8px',
                      background: 'rgba(34,197,94,0.8)',
                      borderRadius: '12px',
                      backdropFilter: 'blur(6px)',
                    }}
                  >
                    <Eye size={11} color="#fff" />
                    <Typography
                      sx={{
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        color: '#fff',
                        fontFamily: "'Geist Mono', monospace",
                      }}
                    >
                      {d.class}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}

            <Box
              sx={{
                position: 'absolute',
                top: 8,
                left: 10,
                right: 8,
                overflow: 'hidden',
              }}
            >
              <Typography
                noWrap
                sx={{
                  fontSize: '0.6rem',
                  color: 'rgba(255,255,255,0.5)',
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                }}
              >
                {webcam.activeLabel || 'Webcam'}
              </Typography>
            </Box>
          </Box>
        )}

        {/* ── Camera picker ── */}
        {liveEvents && webcam.devices.length > 0 && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              padding: '6px 10px',
              background: 'rgba(255,255,255,0.02)',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <Camera size={12} color={PANEL_MUTED} />
            <select
              value={webcam.selectedDeviceId}
              onChange={(e) => webcam.selectDevice(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                color: PANEL_TEXT_DIM,
                fontSize: '0.72rem',
                flex: 1,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {webcam.devices.map((d) => (
                <option
                  key={d.deviceId}
                  value={d.deviceId}
                  style={{ background: PANEL_BG, color: PANEL_TEXT }}
                >
                  {d.label}
                </option>
              ))}
            </select>
          </Box>
        )}

        {/* ── Event status strip ── */}
        <Box
          sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}
        >
          <Box
            sx={{
              padding: '10px 12px',
              background: gestureActive
                ? 'rgba(99,102,241,0.1)'
                : 'rgba(255,255,255,0.03)',
              border: gestureActive
                ? '1px solid rgba(99,102,241,0.35)'
                : '1px solid rgba(255,255,255,0.07)',
              borderRadius: '8px',
              transition: 'all 0.2s ease',
            }}
          >
            <Typography
              sx={{
                fontSize: '0.66rem',
                color: PANEL_MUTED,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: '5px',
              }}
            >
              Gesture
            </Typography>
            <Stack direction="row" sx={{ alignItems: 'center' }} spacing={0.8}>
              <Hand
                size={13}
                color={gestureActive ? ACCENT_INDIGO_LIGHT : PANEL_FAINT}
              />
              <Typography
                sx={{
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: gestureActive ? ACCENT_INDIGO_FAINT : PANEL_FAINT,
                  fontFamily: "'Geist Mono', monospace",
                }}
              >
                {activeGesture || 'NONE'}
              </Typography>
            </Stack>
          </Box>

          <Box
            sx={{
              padding: '10px 12px',
              background:
                activeDetections.length > 0
                  ? 'rgba(34,197,94,0.08)'
                  : 'rgba(255,255,255,0.03)',
              border:
                activeDetections.length > 0
                  ? '1px solid rgba(34,197,94,0.3)'
                  : '1px solid rgba(255,255,255,0.07)',
              borderRadius: '8px',
              transition: 'all 0.2s ease',
            }}
          >
            <Typography
              sx={{
                fontSize: '0.66rem',
                color: PANEL_MUTED,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: '5px',
              }}
            >
              Objects
            </Typography>
            <Stack direction="row" sx={{ alignItems: 'center' }} spacing={0.8}>
              <Eye
                size={13}
                color={activeDetections.length > 0 ? C_SUCCESS : PANEL_FAINT}
              />
              <Typography
                sx={{
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color:
                    activeDetections.length > 0
                      ? ACCENT_GREEN_LIGHT
                      : PANEL_FAINT,
                  fontFamily: "'Geist Mono', monospace",
                }}
              >
                {activeDetections.length > 0
                  ? activeDetections
                      .slice(0, 2)
                      .map((d) => d.class)
                      .join(', ')
                  : 'none'}
              </Typography>
            </Stack>
          </Box>
        </Box>

        {/* ── Voice command (live) ── */}
        {liveEvents && (
          <Box
            sx={{
              padding: '10px 12px',
              background: voice.word
                ? 'rgba(99,102,241,0.1)'
                : 'rgba(255,255,255,0.03)',
              border: voice.word
                ? '1px solid rgba(99,102,241,0.35)'
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
              Voice
            </Typography>
            <Stack direction="row" sx={{ alignItems: 'center' }} spacing={0.8}>
              <Mic size={13} color={voice.word ? '#818CF8' : '#475569'} />
              <Typography
                sx={{
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: voice.word ? '#A5B4FC' : '#475569',
                  fontFamily: "'Geist Mono', monospace",
                }}
              >
                {!voice.browserSupported
                  ? 'not supported in this browser'
                  : voice.word || (voice.active ? 'listening…' : 'idle')}
              </Typography>
            </Stack>
          </Box>
        )}

        {/* ── Execution target (Simulation vs Real Robot) ── */}
        <Box>
          <ToggleButtonGroup
            value={executionTarget}
            exclusive
            fullWidth
            size="small"
            disabled={simulation.isRunning}
            onChange={(_, v) => v && setExecutionTarget(v)}
            sx={{
              '& .MuiToggleButton-root': {
                textTransform: 'none',
                fontSize: '0.78rem',
                fontWeight: 500,
                color: PANEL_TEXT_DIM,
                borderColor: 'rgba(255,255,255,0.1)',
                py: 0.6,
              },
              '& .MuiToggleButton-root.Mui-selected': {
                color: '#fff',
                background: 'rgba(99,102,241,0.25)',
                '&:hover': { background: 'rgba(99,102,241,0.32)' },
              },
            }}
          >
            <ToggleButton value="sim">
              <MonitorPlay size={14} style={{ marginRight: 6 }} />
              Simulation
            </ToggleButton>
            <ToggleButton value="real">
              <Cpu size={14} style={{ marginRight: 6 }} />
              Real Robot
            </ToggleButton>
          </ToggleButtonGroup>

          {/* Safety banner */}
          <Box
            sx={{
              mt: 1,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 12px',
              borderRadius: '8px',
              background:
                executionTarget === 'real'
                  ? 'rgba(245,158,11,0.12)'
                  : 'rgba(99,102,241,0.1)',
              border:
                executionTarget === 'real'
                  ? '1px solid rgba(245,158,11,0.4)'
                  : '1px solid rgba(99,102,241,0.3)',
            }}
          >
            {executionTarget === 'real' ? (
              <AlertTriangle size={15} color={C_WARNING} />
            ) : (
              <MonitorPlay size={15} color={ACCENT_INDIGO_LIGHT} />
            )}
            <Typography
              sx={{
                fontSize: '0.72rem',
                color:
                  executionTarget === 'real'
                    ? C_WARNING_LIGHT
                    : ACCENT_INDIGO_FAINT,
              }}
            >
              {executionTarget === 'real'
                ? 'Live hardware — the real robot will move'
                : 'Safe — runs in the simulation only'}
            </Typography>
          </Box>

          {/* Robot picker (real mode only) */}
          {executionTarget === 'real' && (
            <FormControl fullWidth size="small" sx={{ mt: 1 }}>
              <InputLabel id="dt-robot-label" sx={{ color: PANEL_TEXT_DIM }}>
                Robot
              </InputLabel>
              <Select
                labelId="dt-robot-label"
                label="Robot"
                value={selectedRobot || ''}
                disabled={simulation.isRunning}
                onChange={(e) => setSelectedRobot(e.target.value)}
                sx={{
                  color: PANEL_TEXT,
                  fontSize: '0.82rem',
                  '.MuiOutlinedInput-notchedOutline': {
                    borderColor: 'rgba(255,255,255,0.15)',
                  },
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: 'rgba(255,255,255,0.3)',
                  },
                  '.MuiSvgIcon-root': { color: PANEL_TEXT_DIM },
                }}
              >
                {(dataMyRobots ?? []).map((r) => (
                  <MenuItem key={r.id} value={r.id}>
                    {r.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
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
              color: PANEL_FAINT,
              marginBottom: '3px',
              letterSpacing: '0.05em',
            }}
          >
            STATUS
          </Typography>
          <Stack direction="row" sx={{ alignItems: 'center' }} spacing={1}>
            {simulation.isRunning && (
              <CircularProgress size={11} sx={{ color: C_PRIMARY }} />
            )}
            <Typography
              sx={{
                fontSize: '0.8rem',
                fontWeight: 500,
                color: simulation.isRunning ? ACCENT_INDIGO_LIGHT : PANEL_MUTED,
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
          <Box>
            <Typography sx={{ fontSize: '0.78rem', color: PANEL_TEXT_DIM }}>
              Use live camera
            </Typography>
            <Typography
              sx={{ fontSize: '0.65rem', color: PANEL_MUTED, mt: 0.2 }}
            >
              {liveEvents && webcam.active
                ? 'Webcam on — detecting gestures & objects'
                : 'Detect real gestures & objects from webcam'}
            </Typography>
          </Box>
          <Tooltip
            title={
              liveEvents
                ? 'Webcam on — gestures & objects must really happen'
                : 'Events auto-completed'
            }
          >
            <Switch
              size="small"
              checked={liveEvents}
              onChange={(e) => setLiveEvents(e.target.checked)}
              disabled={simulation.isRunning}
              sx={{
                '& .MuiSwitch-switchBase.Mui-checked': { color: C_PRIMARY },
                '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                  backgroundColor: C_PRIMARY,
                },
              }}
            />
          </Tooltip>
        </Box>

        {/* ── Run / Stop (single action, swaps while running) ── */}
        <Box>
          <Button
            fullWidth
            onClick={simulation.isRunning ? stopSimulation : handleRun}
            disabled={
              !simulation.isRunning &&
              (!canRun || (executionTarget === 'real' && !selectedRobot))
            }
            variant="contained"
            color={simulation.isRunning ? 'error' : 'primary'}
            startIcon={
              simulation.isRunning ? <Square size={15} /> : <Play size={15} />
            }
            sx={{
              borderRadius: '8px',
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '0.85rem',
              py: 1,
              boxShadow: 'none',
              '&:hover': { boxShadow: 'none' },
              ...(simulation.isRunning
                ? {}
                : {
                    background: C_PRIMARY,
                    '&:hover': {
                      background: C_PRIMARY_DARK,
                      boxShadow: 'none',
                    },
                  }),
              '&.Mui-disabled': {
                background: 'rgba(99,102,241,0.18)',
                color: 'rgba(255,255,255,0.4)',
              },
            }}
          >
            {simulation.isRunning
              ? 'Stop'
              : executionTarget === 'real'
                ? 'Run on Robot'
                : 'Run'}
          </Button>
          {executionTarget === 'real' && (
            <Typography
              sx={{
                fontSize: '0.66rem',
                color: PANEL_TEXT_DIM,
                mt: 0.8,
                textAlign: 'center',
              }}
            >
              Use the teach-pendant e-stop to stop the arm immediately.
            </Typography>
          )}
          {!simulation.isRunning && !canRun && (
            <Typography
              sx={{
                fontSize: '0.66rem',
                color: C_WARNING_LIGHT,
                mt: 0.8,
                textAlign: 'center',
              }}
            >
              {taskStatus === 'published_with_draft'
                ? 'Pending draft — publish or discard it to run. Webcam still works for testing gestures.'
                : 'Draft task — publish it to run. Webcam still works for testing gestures.'}
            </Typography>
          )}
        </Box>
      </Box>

      {/* ── Confirm real-robot run ── */}
      <Dialog
        open={confirmRealRun}
        onClose={() => setConfirmRealRun(false)}
        slotProps={{
          paper: { sx: { borderRadius: '12px', p: 1, maxWidth: 420 } },
        }}
      >
        <DialogTitle sx={{ fontWeight: 600, fontSize: '1.05rem' }}>
          Run on the real robot?
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            The physical robot will move and execute this task. Make sure the
            workcell is clear and the e-stop is within reach.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 1.5, justifyContent: 'space-between' }}>
          <Button
            variant="text"
            onClick={() => setConfirmRealRun(false)}
            sx={{ fontWeight: 500 }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={confirmAndRun}
            startIcon={<AlertTriangle size={15} />}
            sx={{ borderRadius: '8px', textTransform: 'none', fontWeight: 600 }}
          >
            Run on robot
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
