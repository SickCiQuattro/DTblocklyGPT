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
  VideoOff,
  Bell,
} from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'
import * as Blockly from 'blockly/core'
import { useTheme } from '@mui/material/styles'

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
import {
  highlightExecutingBlock,
  clearExecutingHighlights,
} from 'features/blockly/utils/blockHighlight'
import { SegmentedControl } from 'components/SegmentedControl'

import { panel } from './digitalTwin/panelTokens'

const MJPEG_URL = '/camera/stream?topic=/camera/image_raw&type=mjpeg'

interface DigitalTwinPanelProps {
  taskId: string
  taskStatus?: TaskStatus
  /** Live editor workspace, used to highlight the block currently executing. */
  workspace?: Blockly.WorkspaceSvg | null
}

// Section-header pattern shared by LIVE VIEW / EVENTS / RUN, matching the
// toolbox/chat header label style (uppercase, wide tracking, dim color).
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <Typography
    sx={{
      fontSize: '0.68rem',
      fontWeight: 700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: panel.muted,
      mb: 1,
    }}
  >
    {children}
  </Typography>
)

export const DigitalTwinPanel: React.FC<DigitalTwinPanelProps> = ({
  taskId,
  taskStatus,
  workspace,
}) => {
  const theme = useTheme()
  const dispatch = useDispatch()
  const simulation = useSelector((state: any) => state.simulation)
  const simOpen = useAppSelector((state) => state.task.simOpen)

  // Camera and voice are independent toggles — mic permission shouldn't be
  // required just to test gestures, and vice versa. Object detection is a
  // sub-toggle of the camera (see webcam.detectObjects) since it needs frames.
  const [cameraOn, setCameraOn] = useState(false)
  const [voiceOn, setVoiceOn] = useState(false)
  const liveActive = cameraOn || voiceOn
  const [liveView, setLiveView] = useState<'simulation' | 'camera'>(
    'simulation',
  )
  const [stepCompleted, setStepCompleted] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [notifyBanner, setNotifyBanner] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<{
    ok: boolean
    text: string
  } | null>(null)
  const wasRunningRef = useRef(false)
  const autoSwitchedToCameraRef = useRef(false)
  const [executionTarget, setExecutionTarget] = useState<'sim' | 'real'>('sim')
  const [confirmRealRun, setConfirmRealRun] = useState(false)
  // Hardware-armed status (server DRIVE_HARDWARE + cobotta_node reachable),
  // fetched when "Real robot" is selected — the b-CAP host is server config
  // now, not a per-request robot picker.
  const [hwStatus, setHwStatus] = useState<{
    armed: boolean
    hardware: { move_target_available?: boolean; halt_available?: boolean }
  } | null>(null)

  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

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
  const activeGesture = cameraOn && webcam.active ? webcam.gesture : rosGesture
  const activeDetections =
    cameraOn && webcam.active ? webcam.detections : objectDetection.detections

  // Camera and voice each start/stop independently.
  useEffect(() => {
    if (cameraOn) {
      webcam.start()
    } else {
      webcam.stop()
    }
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [cameraOn])

  useEffect(() => {
    if (voiceOn) {
      voice.start()
    } else {
      voice.stop()
    }
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [voiceOn])

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

  // Run-result banner: without this, a run silently flips back to idle with
  // no feedback (the peak-end payoff of the whole flow), see peer message
  // text below. Skip the user's own "Simulation stopped" — that's already
  // self-evident from having just pressed Stop.
  useEffect(() => {
    const wasRunning = wasRunningRef.current
    wasRunningRef.current = simulation.isRunning
    if (!wasRunning || simulation.isRunning) return
    if (simulation.message === 'Simulation stopped') return
    setRunResult({
      ok: simulation.message === 'Simulation completed',
      text:
        simulation.message === 'Simulation completed'
          ? 'Task completed successfully'
          : simulation.message,
    })
    const t = setTimeout(() => setRunResult(null), 5000)
    return () => clearTimeout(t)
  }, [simulation.isRunning, simulation.message])

  // Hardware-armed badge: fetch once when "Real robot" is selected. Not
  // polled — the badge is a pre-flight check at selection time, not a live
  // status monitor; re-select the target (or retry the run) to refresh it.
  useEffect(() => {
    if (executionTarget !== 'real') return
    let cancelled = false
    fetchApi<{
      armed: boolean
      hardware: { move_target_available?: boolean; halt_available?: boolean }
    }>({ url: endpoints.task.hardwareStatus, method: MethodHTTP.GET })
      .then((status) => {
        if (!cancelled) setHwStatus(status)
      })
      .catch(() => {
        if (!cancelled) setHwStatus({ armed: false, hardware: {} })
      })
    return () => {
      cancelled = true
    }
  }, [executionTarget])

  const hardwareArmed = !!(
    hwStatus?.armed && hwStatus.hardware.move_target_available
  )

  // Single run path for both targets — the twin (IK, abort-on-fault gates,
  // encoder verification) is identical either way; driveHardware just tells
  // the server to also forward key poses to the real arm via cobotta_node.
  // "Simulation" NEVER sets this — the physical arm cannot move from that button.
  const runTask = async (driveHardware: boolean) => {
    if (!taskId || !canRun) return
    dispatch(startSimAction())
    try {
      await fetchApi({
        url: endpoints.task.simulate,
        method: MethodHTTP.POST,
        body: {
          id: Number(taskId),
          simulateEvent: !liveActive,
          driveHardware,
        },
      })
      dispatch(setSimulationCompleted())
    } catch (error: any) {
      console.error('Error running task:', error)
      dispatch(setSimulationError(error?.message || 'Error running task'))
    }
  }

  // Real-robot runs go through a confirm dialog (irreversible physical motion).
  const handleRun = () => {
    if (executionTarget === 'real') {
      setConfirmRealRun(true)
      return
    }
    runTask(false)
  }

  const confirmAndRun = () => {
    setConfirmRealRun(false)
    runTask(true)
  }

  const stopSimulation = () => {
    dispatch(stopSimAction())
    // stop_simulation() halts the parser, Gazebo, and — if a hardware run is
    // in flight — the real arm via the halt channel. Fire-and-forget: the UI
    // already reflects "stopped" from the Redux dispatch above regardless.
    fetchApi({ url: endpoints.task.stop, method: MethodHTTP.POST }).catch(
      (error: any) => console.error('Error stopping simulation:', error),
    )
  }
  const handleClose = () => dispatch(toggleSim())

  // Focus the panel when it opens; return focus to whatever triggered it
  // (the Header's "Robot" toggle) when it closes.
  useEffect(() => {
    if (simOpen) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement
      panelRef.current?.focus()
    } else {
      previouslyFocusedRef.current?.focus()
    }
  }, [simOpen])

  // Esc closes the panel, matching the close button.
  useEffect(() => {
    if (!simOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [simOpen])

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

  const eventsVisible = liveActive || simulation.isRunning

  // Guided view: a human step waiting on a gesture or object needs the
  // camera on screen, but a novice won't know to flip the Simulation/Camera
  // toggle AND the Camera switch themselves. Auto-switch to the camera view
  // (turning the webcam on if needed) when such a step starts, and return to
  // the simulation view once it resolves — but only if we're the ones who
  // switched away, so a manual override during the step isn't fought. The
  // webcam itself stays on afterwards (see the `cameraOn` effect above) so
  // the operator can keep testing recognition if they want.
  const needsCameraInput =
    isHumanStepActive &&
    (humanStep?.condition === 'gesture' ||
      humanStep?.condition === 'find_object')
  useEffect(() => {
    if (needsCameraInput) {
      if (liveView !== 'camera') {
        setLiveView('camera')
        autoSwitchedToCameraRef.current = true
      }
      if (!cameraOn) setCameraOn(true)
    } else if (autoSwitchedToCameraRef.current) {
      setLiveView('simulation')
      autoSwitchedToCameraRef.current = false
    }
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [needsCameraInput])

  // Preflight checklist: the system already knows what a task needs (its own
  // block types, its publish status, the selected target) — say so up front
  // with an inline fix, instead of a novice discovering it only after Run
  // does nothing.
  const needsCameraOrVoice = !!workspace
    ?.getAllBlocks(false)
    .some((b) =>
      ['gesture_block', 'find_object_block', 'voice_command_block'].includes(
        b.type,
      ),
    )
  interface PreflightIssue {
    text: string
    action?: { label: string; onClick: () => void }
  }
  const preflightIssues: PreflightIssue[] = []
  if (!canRun) {
    preflightIssues.push({
      text:
        taskStatus === 'published_with_draft'
          ? 'Unpublished changes — use Save & Publish in the top bar to run them.'
          : 'This task is a draft — use Save & Publish in the top bar to run it.',
    })
  }
  if (executionTarget === 'real' && !hardwareArmed) {
    preflightIssues.push({
      text:
        hwStatus === null
          ? 'Checking the robot connection…'
          : 'Robot not connected — check the hardware connection before running.',
    })
  }
  if (needsCameraOrVoice && !liveActive) {
    preflightIssues.push({
      text: 'This task uses gesture, voice or object recognition.',
      action: {
        label: 'Turn on camera & voice',
        onClick: () => {
          setCameraOn(true)
          setVoiceOn(true)
        },
      },
    })
  }

  return (
    <Box
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby="digital-twin-title"
      aria-hidden={!simOpen}
      tabIndex={-1}
      sx={{
        position: 'fixed',
        right: '12px',
        top: 'calc(var(--layout-appbar-height, 56px) + 12px)',
        bottom: 'calc(var(--layout-statusbar-height, 40px) + 12px)',
        width: '35vw',
        zIndex: 100,
        background: panel.surface,
        backdropFilter: 'blur(24px)',
        borderRadius: '16px',
        border: `1px solid ${panel.hairlineStrong}`,
        boxShadow: theme.customShadows.cardDark,
        transform: simOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        overflow: 'hidden',
        color: panel.text,
        outline: 'none',
      }}
    >
      {/* ── Header ── */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 18px',
          background: panel.chrome,
          borderBottom: `1px solid ${panel.hairline}`,
          flexShrink: 0,
        }}
      >
        <Stack direction="row" sx={{ alignItems: 'center' }} spacing={1.5}>
          <Camera size={16} color={panel.primary} />
          <Typography
            id="digital-twin-title"
            sx={{
              fontWeight: 600,
              fontSize: '0.9rem',
              letterSpacing: '-0.01em',
            }}
          >
            Robot
          </Typography>
          <Stack
            direction="row"
            spacing={0.6}
            sx={{
              alignItems: 'center',
              ...(!connected && {
                px: 1,
                py: 0.25,
                borderRadius: '999px',
                bgcolor: panel.warningTint(0.12),
                border: `1px solid ${panel.warningTint(0.4)}`,
              }),
            }}
          >
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: connected ? panel.success : panel.warning,
              }}
            />
            <Typography
              sx={{
                fontSize: '0.68rem',
                color: connected ? panel.textDim : panel.warningLight,
              }}
            >
              {connected ? 'Connected' : 'Offline'}
            </Typography>
          </Stack>
        </Stack>
        <IconButton
          onClick={handleClose}
          size="small"
          aria-label="Close robot panel"
          sx={{
            color: panel.iconMuted,
            '&:hover': { color: panel.white, background: panel.hover },
          }}
        >
          <X size={16} />
        </IconButton>
      </Box>

      {/* ── Scrollable body ── */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          padding: '14px 16px',
          overflowY: 'auto',
        }}
      >
        {/* ── Run-result banner (transient) ── */}
        {runResult && (
          <Box
            role="status"
            aria-live="polite"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 14px',
              background: runResult.ok
                ? panel.successTint(0.12)
                : panel.errorTint(0.12),
              border: `1px solid ${runResult.ok ? panel.successTint(0.35) : panel.errorTint(0.35)}`,
              borderRadius: '8px',
            }}
          >
            {runResult.ok ? (
              <CheckCircle2 size={15} color={panel.successLight} />
            ) : (
              <AlertTriangle size={15} color={panel.errorLight} />
            )}
            <Typography
              sx={{
                fontSize: '0.78rem',
                fontWeight: 600,
                color: runResult.ok ? panel.successLight : panel.errorLight,
              }}
            >
              {runResult.text}
            </Typography>
          </Box>
        )}

        {/* ── Notify banner (transient) ── */}
        {notifyBanner && (
          <Box
            role="status"
            aria-live="polite"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 14px',
              background: panel.primaryTint(0.1),
              border: `1px solid ${panel.primaryTint(0.3)}`,
              borderRadius: '8px',
            }}
          >
            <Bell size={15} color={panel.primaryLight} />
            <Typography sx={{ fontSize: '0.78rem', color: panel.primaryFaint }}>
              {notifyBanner}
            </Typography>
          </Box>
        )}

        {/* ── Timeout warning ── */}
        {isTimeout && (
          <Box
            role="status"
            aria-live="polite"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 14px',
              background: panel.warningTint(0.12),
              border: `1px solid ${panel.warningTint(0.3)}`,
              borderRadius: '8px',
            }}
          >
            <AlertTriangle size={15} color={panel.warning} />
            <Typography sx={{ fontSize: '0.78rem', color: panel.warningLight }}>
              Timeout:{' '}
              {humanStep?.condition === 'gesture'
                ? `gesture "${humanStep?.value}" not detected`
                : `object "${humanStep?.value}" not detected`}{' '}
              — simulation continued
            </Typography>
          </Box>
        )}

        {/* ── LIVE VIEW ── */}
        <Box>
          <Stack
            direction="row"
            sx={{
              justifyContent: 'space-between',
              alignItems: 'center',
              mb: 1,
            }}
          >
            <SectionLabel>Live view</SectionLabel>
            <SegmentedControl
              dark
              value={liveView}
              exclusive
              onChange={(_, v) => v && setLiveView(v)}
              options={[
                { value: 'simulation', label: 'Simulation' },
                { value: 'camera', label: 'Test recognition' },
              ]}
            />
          </Stack>

          {liveView === 'simulation' ? (
            <>
              <Box
                sx={{
                  position: 'relative',
                  width: '100%',
                  aspectRatio: '4/3',
                  background: panel.videoBg,
                  borderRadius: '10px',
                  overflow: 'hidden',
                  border: `1px solid ${panel.hairlineStrong}`,
                  flexShrink: 0,
                }}
              >
                {simulation.isRunning ? (
                  <img
                    src={MJPEG_URL}
                    alt="Robot camera feed"
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
                    <Camera size={28} color={panel.border} />
                    <Typography
                      sx={{ fontSize: '0.78rem', color: panel.faint }}
                    >
                      Start a simulation to see the robot here
                    </Typography>
                  </Box>
                )}

                {/* Human step overlay */}
                {isHumanStepActive && (
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      background: panel.overlayScrim,
                      backdropFilter: 'blur(4px)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 1.5,
                      padding: '20px',
                      '@media (prefers-reduced-motion: no-preference)': {
                        animation: 'dt-fade-in 0.25s ease',
                      },
                      '@keyframes dt-fade-in': {
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
                        background: panel.primaryTint(0.15),
                        border: `2px solid ${panel.primaryTint(0.5)}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Hand size={22} color={panel.primaryLight} />
                    </Box>
                    <Typography
                      sx={{
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        textAlign: 'center',
                        color: panel.text,
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
                      <CircularProgress
                        size={10}
                        sx={{ color: panel.primary }}
                      />
                      <Typography
                        sx={{ fontSize: '0.72rem', color: panel.textDim }}
                      >
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
                      background: panel.successTint(0.15),
                      border: `1px solid ${panel.successTint(0.4)}`,
                      borderRadius: '20px',
                      backdropFilter: 'blur(8px)',
                    }}
                  >
                    <CheckCircle2 size={13} color={panel.success} />
                    <Typography
                      sx={{
                        fontSize: '0.72rem',
                        color: panel.successLight,
                        fontWeight: 500,
                      }}
                    >
                      Step completed
                    </Typography>
                  </Box>
                )}
              </Box>

              {/* Gesture match — only while a human step is waiting on one */}
              {isHumanStepActive && expectedGesture && (
                <Box
                  sx={{
                    mt: 1.5,
                    padding: '14px 16px',
                    background: gestureMatch
                      ? panel.successTint(0.1)
                      : panel.primaryTint(0.07),
                    border: gestureMatch
                      ? `1px solid ${panel.successTint(0.35)}`
                      : `1px solid ${panel.primaryTint(0.2)}`,
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
                          color: panel.muted,
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
                            ? panel.successLight
                            : panel.primaryFaint,
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
                          color: panel.muted,
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
                            ? panel.successLight
                            : gestureActive
                              ? panel.primaryLight
                              : panel.faint,
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
                        aria-live="polite"
                        aria-label={`${countdown} seconds remaining`}
                        sx={{
                          height: 3,
                          borderRadius: 2,
                          mb: 0.5,
                          backgroundColor: panel.trackBg,
                          '& .MuiLinearProgress-bar': {
                            backgroundColor:
                              countdown < 10
                                ? panel.error
                                : countdown < 20
                                  ? panel.warning
                                  : panel.primary,
                            borderRadius: 2,
                          },
                        }}
                      />
                      <Typography
                        sx={{
                          fontSize: '0.68rem',
                          color:
                            countdown < 10 ? panel.errorLight : panel.muted,
                          textAlign: 'right',
                        }}
                      >
                        {countdown}s
                      </Typography>
                    </>
                  )}
                </Box>
              )}
            </>
          ) : (
            <Box>
              <Stack
                direction="row"
                sx={{
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Box>
                  <Typography
                    sx={{ fontSize: '0.78rem', color: panel.textDim }}
                  >
                    Camera
                  </Typography>
                  <Typography sx={{ fontSize: '0.65rem', color: panel.muted }}>
                    {cameraOn && webcam.active
                      ? 'Webcam on — detecting gestures'
                      : 'Try it out any time — see how gesture recognition works before running the task'}
                  </Typography>
                </Box>
                <Tooltip
                  title={
                    cameraOn
                      ? 'Webcam on — gestures must really happen'
                      : 'Gesture events auto-completed'
                  }
                >
                  <Switch
                    size="small"
                    checked={cameraOn}
                    onChange={(e) => setCameraOn(e.target.checked)}
                    disabled={simulation.isRunning}
                    sx={{
                      '& .MuiSwitch-switchBase.Mui-checked': {
                        color: panel.primary,
                      },
                      '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track':
                        {
                          backgroundColor: panel.primary,
                        },
                    }}
                  />
                </Tooltip>
              </Stack>

              <Stack
                direction="row"
                sx={{
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  pl: 2,
                  mb: 1,
                  opacity: cameraOn ? 1 : 0.5,
                }}
              >
                <Box>
                  <Typography
                    sx={{ fontSize: '0.72rem', color: panel.textDim }}
                  >
                    Object detection
                  </Typography>
                  <Typography sx={{ fontSize: '0.62rem', color: panel.muted }}>
                    Runs YOLO on the webcam feed here — never affects real task
                    runs (those use the robot camera only)
                  </Typography>
                </Box>
                <Tooltip
                  title={
                    !cameraOn
                      ? 'Turn on the camera first'
                      : webcam.detectObjects
                        ? 'Object detection on'
                        : 'Object detection off'
                  }
                >
                  <span>
                    <Switch
                      size="small"
                      checked={webcam.detectObjects}
                      onChange={(e) =>
                        webcam.setDetectObjects(e.target.checked)
                      }
                      disabled={!cameraOn || simulation.isRunning}
                      sx={{
                        '& .MuiSwitch-switchBase.Mui-checked': {
                          color: panel.primary,
                        },
                        '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track':
                          {
                            backgroundColor: panel.primary,
                          },
                      }}
                    />
                  </span>
                </Tooltip>
              </Stack>

              <Stack
                direction="row"
                sx={{
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  mb: 1,
                }}
              >
                <Box>
                  <Typography
                    sx={{ fontSize: '0.78rem', color: panel.textDim }}
                  >
                    Voice
                  </Typography>
                  <Typography sx={{ fontSize: '0.65rem', color: panel.muted }}>
                    {!voice.browserSupported
                      ? 'Not supported in this browser (Chrome only)'
                      : voiceOn
                        ? 'Listening — say yes / no / done / proceed'
                        : 'Try voice commands independently of the camera'}
                  </Typography>
                </Box>
                <Tooltip
                  title={
                    voiceOn
                      ? 'Microphone on — voice events must really happen'
                      : 'Voice events auto-completed'
                  }
                >
                  <span>
                    <Switch
                      size="small"
                      checked={voiceOn}
                      onChange={(e) => setVoiceOn(e.target.checked)}
                      disabled={simulation.isRunning || !voice.browserSupported}
                      sx={{
                        '& .MuiSwitch-switchBase.Mui-checked': {
                          color: panel.primary,
                        },
                        '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track':
                          {
                            backgroundColor: panel.primary,
                          },
                      }}
                    />
                  </span>
                </Tooltip>
              </Stack>

              {!cameraOn ? (
                <Box
                  sx={{
                    width: '100%',
                    aspectRatio: '16/9',
                    borderRadius: '10px',
                    border: `1px solid ${panel.hairlineStrong}`,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 1.5,
                  }}
                >
                  <Camera size={28} color={panel.border} />
                  <Typography sx={{ fontSize: '0.78rem', color: panel.faint }}>
                    Turn on the camera above to test gesture &amp; object
                    recognition
                  </Typography>
                </Box>
              ) : (
                <Box
                  sx={{
                    position: 'relative',
                    width: '100%',
                    aspectRatio: '16/9',
                    background: panel.videoBg,
                    borderRadius: '10px',
                    overflow: 'hidden',
                    border: webcam.error
                      ? `1px solid ${panel.errorTint(0.4)}`
                      : `1px solid ${panel.hairlineStrong}`,
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
                      <CircularProgress
                        size={20}
                        sx={{ color: panel.primary }}
                      />
                      <Typography
                        sx={{ fontSize: '0.72rem', color: panel.textDim }}
                      >
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
                      <VideoOff size={22} color={panel.errorLight} />
                      <Typography
                        sx={{
                          fontSize: '0.72rem',
                          color: panel.errorLight,
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
                            background: panel.primaryTint(0.85),
                            borderRadius: '12px',
                            backdropFilter: 'blur(6px)',
                          }}
                        >
                          <Hand size={11} color={panel.white} />
                          <Typography
                            sx={{
                              fontSize: '0.65rem',
                              fontWeight: 600,
                              color: panel.white,
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
                            background: panel.successTint(0.8),
                            borderRadius: '12px',
                            backdropFilter: 'blur(6px)',
                          }}
                        >
                          <Eye size={11} color={panel.white} />
                          <Typography
                            sx={{
                              fontSize: '0.65rem',
                              fontWeight: 600,
                              color: panel.white,
                              fontFamily: "'Geist Mono', monospace",
                            }}
                          >
                            {d.color ? `${d.class} · ${d.color}` : d.class}
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
                        color: panel.videoLabel,
                        letterSpacing: '0.07em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {webcam.activeLabel || 'Webcam'}
                    </Typography>
                  </Box>
                </Box>
              )}

              {/* Camera picker */}
              {cameraOn && webcam.devices.length > 0 && (
                <FormControl
                  fullWidth
                  size="small"
                  sx={{
                    mt: 1,
                    '.MuiOutlinedInput-notchedOutline': {
                      borderColor: panel.selectBorder,
                    },
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                      borderColor: panel.selectBorderHover,
                    },
                    '.MuiSvgIcon-root': { color: panel.textDim },
                  }}
                >
                  <InputLabel
                    id="dt-camera-label"
                    sx={{ color: panel.textDim }}
                  >
                    Camera source
                  </InputLabel>
                  <Select
                    labelId="dt-camera-label"
                    label="Camera source"
                    value={webcam.selectedDeviceId}
                    onChange={(e) => webcam.selectDevice(e.target.value)}
                    sx={{ color: panel.text, fontSize: '0.82rem' }}
                  >
                    {webcam.devices.map((d) => (
                      <MenuItem key={d.deviceId} value={d.deviceId}>
                        {d.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </Box>
          )}
        </Box>

        {/* ── EVENTS — only while events can actually happen ── */}
        {eventsVisible && (
          <Box>
            <SectionLabel>Events</SectionLabel>
            <Stack spacing={1}>
              <Stack
                direction="row"
                sx={{
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: gestureActive
                    ? panel.primaryTint(0.1)
                    : panel.chromeStrong,
                  border: gestureActive
                    ? `1px solid ${panel.primaryTint(0.35)}`
                    : `1px solid ${panel.hairline}`,
                  borderRadius: '8px',
                }}
              >
                <Stack
                  direction="row"
                  sx={{ alignItems: 'center' }}
                  spacing={0.8}
                >
                  <Hand
                    size={13}
                    color={gestureActive ? panel.primaryLight : panel.faint}
                  />
                  <Typography sx={{ fontSize: '0.72rem', color: panel.muted }}>
                    Gesture
                  </Typography>
                </Stack>
                <Typography
                  sx={{
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color: gestureActive ? panel.primaryFaint : panel.faint,
                    fontFamily: "'Geist Mono', monospace",
                  }}
                >
                  {activeGesture || 'NONE'}
                </Typography>
              </Stack>

              <Stack
                direction="row"
                sx={{
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background:
                    activeDetections.length > 0
                      ? panel.successTint(0.08)
                      : panel.chromeStrong,
                  border:
                    activeDetections.length > 0
                      ? `1px solid ${panel.successTint(0.3)}`
                      : `1px solid ${panel.hairline}`,
                  borderRadius: '8px',
                }}
              >
                <Stack
                  direction="row"
                  sx={{ alignItems: 'center' }}
                  spacing={0.8}
                >
                  <Eye
                    size={13}
                    color={
                      activeDetections.length > 0 ? panel.success : panel.faint
                    }
                  />
                  <Typography sx={{ fontSize: '0.72rem', color: panel.muted }}>
                    Objects
                  </Typography>
                </Stack>
                <Typography
                  sx={{
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color:
                      activeDetections.length > 0
                        ? panel.successLight
                        : panel.faint,
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

              <Stack
                direction="row"
                sx={{
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: voice.word
                    ? panel.primaryTint(0.1)
                    : panel.chromeStrong,
                  border: voice.word
                    ? `1px solid ${panel.primaryTint(0.35)}`
                    : `1px solid ${panel.hairline}`,
                  borderRadius: '8px',
                }}
              >
                <Stack
                  direction="row"
                  sx={{ alignItems: 'center' }}
                  spacing={0.8}
                >
                  <Mic
                    size={13}
                    color={voice.word ? panel.primaryLight : panel.faint}
                  />
                  <Typography sx={{ fontSize: '0.72rem', color: panel.muted }}>
                    Voice
                  </Typography>
                </Stack>
                <Typography
                  sx={{
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color: voice.word ? panel.primaryFaint : panel.faint,
                    fontFamily: "'Geist Mono', monospace",
                  }}
                >
                  {!voice.browserSupported
                    ? 'not supported in this browser'
                    : voice.word || (voice.active ? 'listening…' : 'idle')}
                </Typography>
              </Stack>
            </Stack>
          </Box>
        )}

        {/* ── RUN ── */}
        <Box>
          <SectionLabel>Run</SectionLabel>

          <Box
            sx={{
              padding: '10px 14px',
              background: panel.chrome,
              borderRadius: '8px',
              border: `1px solid ${panel.hairlineStrong}`,
              mb: 1.5,
            }}
          >
            <Typography
              sx={{
                fontFamily: "'Geist Mono', monospace",
                fontSize: '0.68rem',
                color: panel.faint,
                marginBottom: '3px',
                letterSpacing: '0.05em',
              }}
            >
              STATUS
            </Typography>
            <Stack direction="row" sx={{ alignItems: 'center' }} spacing={1}>
              {simulation.isRunning && (
                <CircularProgress size={11} sx={{ color: panel.primary }} />
              )}
              <Typography
                sx={{
                  fontSize: '0.8rem',
                  fontWeight: 500,
                  color: simulation.isRunning
                    ? panel.primaryLight
                    : panel.muted,
                }}
              >
                {simulation.message}
              </Typography>
            </Stack>
          </Box>

          <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography sx={{ fontSize: '0.78rem', color: panel.textDim }}>
              Run in:
            </Typography>
            <SegmentedControl
              dark
              value={executionTarget}
              exclusive
              disabled={simulation.isRunning}
              onChange={(_, v) => v && setExecutionTarget(v)}
              options={[
                {
                  value: 'sim',
                  label: 'Simulation',
                  icon: <MonitorPlay size={13} />,
                },
                {
                  value: 'real',
                  label: 'Real robot',
                  icon: <Cpu size={13} />,
                },
              ]}
            />
          </Stack>

          {/* Both targets get an explicit, honest note — silence on the
              Simulation side would read as "probably fine" rather than the
              actual guarantee (the physical arm cannot move from this button,
              full stop). Progressive disclosure only for the extra hardware
              badge/select, which only matters once "Real robot" is chosen. */}
          {executionTarget === 'sim' && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '8px',
                background: panel.successTint(0.1),
                border: `1px solid ${panel.successTint(0.3)}`,
                mb: 1,
              }}
            >
              <MonitorPlay size={15} color={panel.success} />
              <Typography sx={{ fontSize: '0.72rem', color: panel.textDim }}>
                Twin only — the physical arm never moves from this button.
              </Typography>
            </Box>
          )}

          {executionTarget === 'real' && (
            <>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  background: panel.warningTint(0.12),
                  border: `1px solid ${panel.warningTint(0.4)}`,
                  mb: 1,
                }}
              >
                <AlertTriangle size={15} color={panel.warning} />
                <Typography
                  sx={{ fontSize: '0.72rem', color: panel.warningLight }}
                >
                  Live hardware — the real robot will move
                </Typography>
              </Box>
            </>
          )}
        </Box>
      </Box>

      {/* ── Sticky footer: primary action, always visible ── */}
      <Box
        sx={{
          flexShrink: 0,
          padding: '14px 16px',
          borderTop: `1px solid ${panel.hairline}`,
          background: panel.chrome,
        }}
      >
        <Button
          fullWidth
          onClick={simulation.isRunning ? stopSimulation : handleRun}
          disabled={
            !simulation.isRunning &&
            (!canRun || (executionTarget === 'real' && !hardwareArmed))
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
                  background: panel.primary,
                  '&:hover': {
                    background: panel.primaryDark,
                    boxShadow: 'none',
                  },
                }),
            '&.Mui-disabled': {
              background: panel.primaryTint(0.18),
              color: panel.iconMuted,
            },
          }}
        >
          {simulation.isRunning
            ? 'Stop'
            : executionTarget === 'real'
              ? 'Run on Robot'
              : 'Run simulation'}
        </Button>
        {executionTarget === 'real' && (
          <Typography
            sx={{
              fontSize: '0.66rem',
              color: panel.textDim,
              mt: 0.8,
              textAlign: 'center',
            }}
          >
            Use the teach-pendant e-stop to stop the arm immediately.
          </Typography>
        )}
        {!simulation.isRunning &&
          (preflightIssues.length > 0 ? (
            <Stack spacing={0.6} sx={{ mt: 0.8 }}>
              {preflightIssues.map((issue, i) => (
                <Stack
                  key={i}
                  direction="row"
                  sx={{
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    flexWrap: 'wrap',
                  }}
                >
                  <AlertTriangle
                    size={12}
                    color={panel.warning}
                    style={{ flexShrink: 0 }}
                  />
                  <Typography
                    sx={{
                      fontSize: '0.66rem',
                      color: panel.warningLight,
                      textAlign: 'center',
                    }}
                  >
                    {issue.text}
                  </Typography>
                  {issue.action && (
                    <Button
                      size="small"
                      onClick={issue.action.onClick}
                      sx={{
                        fontSize: '0.64rem',
                        minWidth: 0,
                        py: 0,
                        px: 0.6,
                        textTransform: 'none',
                        color: panel.primaryLight,
                      }}
                    >
                      {issue.action.label}
                    </Button>
                  )}
                </Stack>
              ))}
            </Stack>
          ) : (
            <Stack
              direction="row"
              sx={{
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                mt: 0.8,
              }}
            >
              <CheckCircle2 size={12} color={panel.success} />
              <Typography
                sx={{ fontSize: '0.66rem', color: panel.successLight }}
              >
                Ready to run
              </Typography>
            </Stack>
          ))}
      </Box>

      {/* ── Confirm real-robot run ── */}
      <Dialog
        open={confirmRealRun}
        onClose={() => setConfirmRealRun(false)}
        slotProps={{
          paper: { sx: { p: 1, maxWidth: 420 } },
        }}
      >
        <DialogTitle>Run on the real robot?</DialogTitle>
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
