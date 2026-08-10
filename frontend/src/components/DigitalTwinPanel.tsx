import React, { useEffect, useMemo, useRef, useState } from 'react'
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
  Maximize2,
  Minimize2,
  Info,
} from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'
import * as Blockly from 'blockly/core'
import { useTheme } from '@mui/material/styles'

import { TaskStatus } from 'pages/tasks/types'
import { useAppSelector } from 'store/reducers'
import { toggleSim, toggleRobotPanelWidth } from 'store/reducers/task'
import {
  RECOGNIZED_GESTURES,
  RECOGNIZED_VOICE_COMMANDS,
  gestureLabel,
  voiceLabel,
} from 'constants/recognitionRegistry'
import { UI_TEXT } from 'constants/uiVocabulary'
import { endpoints } from 'services/endpoints'
import { MethodHTTP, fetchApi } from 'services/api'
import {
  startSimulation as startSimAction,
  stopSimulation as stopSimAction,
  setSimulationCompleted,
  setSimulationError,
  setSimulationProgress,
  setSimulationMessage,
} from 'store/reducers/simulation'
import { useRosEvents } from 'hooks/useRosEvents'
import { useWebcamVision } from 'hooks/useWebcamVision'
import { useVoiceCommand } from 'hooks/useVoiceCommand'
import {
  highlightExecutingBlock,
  clearExecutingHighlights,
} from 'features/blockly/utils/blockHighlight'
import { blockMetaByType } from 'features/blockly/toolbox/toolboxRegistry'
import { SegmentedControl } from 'components/SegmentedControl'
import { ConfirmDialog } from 'components/ConfirmDialog'

import { panel } from './digitalTwin/panelTokens'

// STATUS label for a running block. Uses the toolbox's own type→label map so
// the status line says what the palette says ("Execute skill", not
// "processing_block") — the two diverge deliberately and must not be
// re-derived here. Falls back to a de-underscored type for anything not in
// the palette (e.g. hidden blocks that still execute from saved tasks).
const humanizeBlockType = (blockType?: string): string => {
  if (!blockType) return 'Running…'
  const meta = blockMetaByType[blockType]
  if (meta) return meta.label
  return blockType.replace(/_block$/, '').replace(/_/g, ' ')
}

// Shared by every Switch in this panel. MUI's Switch only themes its checked
// state here (see checked-state sx at each call site) — off-state falls back
// to the default light-theme thumb/track (solid white circle), which stands
// out against this panel's dark surface. This covers the off state instead.
const panelSwitchOffSx = {
  '& .MuiSwitch-switchBase': { color: panel.textDim },
  '& .MuiSwitch-track': { backgroundColor: panel.hairlineStrong },
  '& .Mui-disabled': { color: `${panel.muted} !important` },
  '& .Mui-disabled + .MuiSwitch-track': {
    backgroundColor: `${panel.hairline} !important`,
  },
} as const

// Default only resolves through the Vite dev-server proxy (vite.config.mts)
// to web_video_server:8080 — a production build served from Django under
// /static/ has no /camera route, so this needs an absolute override there.
const MJPEG_URL =
  import.meta.env.VITE_CAMERA_STREAM_URL ||
  '/camera/stream?topic=/camera/image_raw&type=mjpeg'

// User-study sessions: force live execution and remove the auto-complete
// escape hatch, so a confirmation channel can never be satisfied by anything
// other than the participant. Pairs with the backend's STRICT_CONDITIONS.
const STUDY_MODE = import.meta.env.VITE_STUDY_MODE === '1'

interface DigitalTwinPanelProps {
  taskId: string
  taskStatus?: TaskStatus
  /** Live editor workspace, used to highlight the block currently executing. */
  workspace?: Blockly.WorkspaceSvg | null
  /** Preselects "Run in" (e.g. arriving via the Tasks list "Run on the real robot" action). Defaults to 'sim'. */
  initialExecutionTarget?: 'sim' | 'real'
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
  initialExecutionTarget,
}) => {
  const theme = useTheme()
  const dispatch = useDispatch()
  const simulation = useSelector((state: any) => state.simulation)
  const simOpen = useAppSelector((state) => state.task.simOpen)
  const robotPanelWidth = useAppSelector((state) => state.task.robotPanelWidth)
  const hasUnsavedEdits = useAppSelector((state) => state.task.hasUnsavedEdits)

  // Sandbox toggles for the "Test recognition" tab only — independent of any
  // run (mic permission shouldn't be required just to test gestures, and
  // vice versa). Object detection is a sub-toggle of the camera (see
  // webcam.detectObjects) since it needs frames. What actually drives a real
  // run is `runMode` below, not these.
  const [testCameraOn, setTestCameraOn] = useState(false)
  const [testVoiceOn, setTestVoiceOn] = useState(false)
  // 'auto': WHEN conditions auto-fulfill, no camera/mic permission requested.
  // 'live': the task's own gesture/voice conditions must really happen —
  // permissions requested at Run, scoped to only what the task uses.
  //
  // STUDY_MODE forces 'live' and hides the toggle. During a user study an
  // accidental auto run is unrecoverable: every confirmation channel reports
  // success without the participant doing anything, and the resulting data is
  // indistinguishable from real data after the fact. Opt-in via
  // VITE_STUDY_MODE so ordinary development keeps the auto default.
  const [runMode, setRunMode] = useState<'auto' | 'live'>(
    STUDY_MODE ? 'live' : 'auto',
  )
  const [liveView, setLiveView] = useState<'simulation' | 'camera'>(
    'simulation',
  )
  // First-MJPEG-frame gate: without this, the video area sits empty (no
  // feedback at all) for however long Gazebo takes to spin up after Run.
  const [feedFrameLoaded, setFeedFrameLoaded] = useState(false)
  // Distinguishes "stream dead" from "Gazebo still booting" — without this
  // the spinner below spins forever if web_video_server/the Vite camera
  // proxy is down, indistinguishable from a slow-starting simulation.
  const [feedError, setFeedError] = useState(false)
  const [stepCompleted, setStepCompleted] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [confirmSending, setConfirmSending] = useState(false)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [notifyBanner, setNotifyBanner] = useState<string | null>(null)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<{
    ok: boolean
    text: string
  } | null>(null)
  const wasRunningRef = useRef(false)
  // Aborts the in-flight /api/task/simulate/ POST on Stop or unmount — without
  // it the 600s request outlives the Stop click and later overwrites the
  // "stopped" status with a stale completed/error result.
  const runAbortRef = useRef<AbortController | null>(null)
  const [executionTarget, setExecutionTarget] = useState<'sim' | 'real'>(
    initialExecutionTarget ?? 'sim',
  )
  const [confirmRealRun, setConfirmRealRun] = useState(false)
  const isWide = robotPanelWidth === 'wide'
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
    blockStepsCompleted,
    connected,
  } = useRosEvents()
  const webcam = useWebcamVision()

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

  // Live progress feedback — block_step 'end' events already exist
  // server-side (_notify_block_step in simulate.py) but nothing consumed
  // them into simulation.progress/message before, so the STATUS line sat
  // frozen on "Starting…" for the whole run, which can legitimately take
  // minutes. Capped short of 100 — a step count is a lower bound on
  // total steps (loops repeat the same block id), not an exact fraction, so
  // it must not claim completion before setSimulationCompleted does.
  // Counted in useRosEvents, not here: under the polling transport a whole
  // burst of block_step events collapses into one re-render carrying only the
  // last one, so counting effect firings silently dropped most steps — and
  // whenever the surviving event was a 'start' it dropped the update
  // altogether, leaving STATUS on "Starting simulation…" for the whole run
  // (confirmed live 2026-07-30). blockStepsCompleted is monotonic across
  // runs, hence the per-run baseline.
  const stepsBaselineRef = useRef(0)
  useEffect(() => {
    if (simulation.isRunning) stepsBaselineRef.current = blockStepsCompleted
    // blockStepsCompleted intentionally omitted: the baseline must be sampled
    // when the run starts, not re-sampled on every step (that would pin it to
    // the live value and make progress permanently 0).
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [simulation.isRunning])
  // Driven by ANY block_step, not only 'end'. Requiring 'end' meant a run
  // whose events all arrived as 'start' (or whose only surviving event in a
  // polled burst was a 'start') never moved the STATUS line off "Starting
  // simulation…" — indistinguishable from a run that never began. The step
  // COUNT still comes from completed steps; the label comes from whatever is
  // executing right now, so the line moves as soon as anything arrives.
  useEffect(() => {
    if (!simulation.isRunning || !blockStep) return
    const steps = blockStepsCompleted - stepsBaselineRef.current
    const label = humanizeBlockType(blockStep.blockType)
    dispatch(
      setSimulationProgress({
        progress: Math.min(95, steps * 5),
        message: steps > 0 ? `${label} — ${steps} done` : label,
      }),
    )
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [blockStep, blockStepsCompleted, simulation.isRunning])

  // A condition wait (when_block on gesture/voice/confirm/find_object) can
  // legitimately hold the STATUS line frozen for its whole timeout (up to
  // 30s+): when_block itself never emits a block_step (only actions do), so
  // if the condition never resolves, nothing in the effect above ever fires
  // and the operator sees "Starting simulation…" the entire time even though
  // the robot is genuinely waiting on them. human_step 'started' already
  // carries condition/value for exactly this wait — surface it on the same
  // STATUS line instead of only in the separate countdown overlay.
  useEffect(() => {
    if (!simulation.isRunning || humanStep?.status !== 'started') return
    const label =
      humanStep.condition === 'gesture'
        ? `Waiting for gesture "${gestureLabel(humanStep.value)}"…`
        : humanStep.condition === 'voice'
          ? `Waiting for voice command "${voiceLabel(humanStep.value)}"…`
          : humanStep.condition === 'object'
            ? `Waiting to find "${humanStep.value}"…`
            : 'Waiting for operator confirmation…'
    dispatch(setSimulationMessage(label))
  }, [humanStep, simulation.isRunning, dispatch])

  // Safety-net cleanup when the run stops (the last block's `end` also clears).
  // Kept separate so `isRunning` isn't a dependency of the per-step effect.
  useEffect(() => {
    if (!simulation.isRunning && workspace) {
      clearExecutingHighlights(workspace)
    }
  }, [simulation.isRunning, workspace])

  // What this task's own blocks actually need — drives which permission a
  // live run asks for (never both by default) and which preflight note to
  // show. find_object is deliberately excluded: it's always the robot
  // camera (vision_node), never the operator's browser webcam.
  // Memoized on [workspace, simulation.isRunning] rather than recomputed
  // every render: this component re-renders at several Hz during a live run
  // (socket events, webcam polling, countdown ticks), and each recompute was
  // a full tree walk. isRunning is in the key so the value is still fresh
  // exactly when runNeedsRef below freezes it — that effect fires on the
  // same dependency.
  const taskNeedsCameraLive = useMemo(
    () =>
      !!workspace?.getAllBlocks(false).some((b) => b.type === 'gesture_block'),
    [workspace, simulation.isRunning],
  )
  const taskNeedsVoiceLive = useMemo(
    () =>
      !!workspace
        ?.getAllBlocks(false)
        .some((b) => b.type === 'voice_command_block'),
    [workspace, simulation.isRunning],
  )

  // Freeze what a run needs at the moment it starts: `workspace` is the live
  // editor (draft) canvas, still mutable while a run is in flight (toolbox
  // is collapsed during a run, but existing blocks can still be deleted).
  // Without this, an edit mid-run can silently flip taskNeedsVoice and kill
  // or start the mic out from under a step that's still waiting on it.
  const runNeedsRef = useRef({
    camera: taskNeedsCameraLive,
    voice: taskNeedsVoiceLive,
  })
  useEffect(() => {
    if (simulation.isRunning) {
      runNeedsRef.current = {
        camera: taskNeedsCameraLive,
        voice: taskNeedsVoiceLive,
      }
    }
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [simulation.isRunning])

  const taskNeedsCamera = simulation.isRunning
    ? runNeedsRef.current.camera
    : taskNeedsCameraLive
  const taskNeedsVoice = simulation.isRunning
    ? runNeedsRef.current.voice
    : taskNeedsVoiceLive
  const needsCameraOrVoice = taskNeedsCamera || taskNeedsVoice

  // Any block whose condition a human is supposed to satisfy — wider than
  // needsCameraOrVoice, which only covers the two channels that request a
  // browser permission. Auto mode short-circuits ALL four channels, so
  // warning only about gesture and voice left button-confirm and find_object
  // silently self-completing: the run looks successful and nothing in the
  // recording shows otherwise.
  const taskHasHumanStep = useMemo(
    () =>
      !!workspace
        ?.getAllBlocks(false)
        .some(
          (b) =>
            b.type === 'human_action_block' ||
            b.type === 'gesture_block' ||
            b.type === 'voice_command_block' ||
            b.type === 'find_object_block' ||
            b.type === 'human_feedback_block',
        ),
    [workspace, simulation.isRunning],
  )

  // The webcam/mic run whenever the sandbox toggle is on OR a live run
  // needs them for this task — one lifecycle, regardless of which reason.
  const cameraActive =
    testCameraOn ||
    (runMode === 'live' && simulation.isRunning && taskNeedsCamera)
  const voiceActive =
    testVoiceOn ||
    (runMode === 'live' && simulation.isRunning && taskNeedsVoice)

  // The hook owns voice's own start/stop/cleanup lifecycle entirely — it
  // just needs to know whether it should be listening right now.
  const voice = useVoiceCommand(voiceActive)

  // Prefer webcam gesture in live mode (lower latency than SocketIO roundtrip)
  const activeGesture =
    cameraActive && webcam.active ? webcam.gesture : rosGesture
  const activeDetections =
    cameraActive && webcam.active
      ? webcam.detections
      : objectDetection.detections

  useEffect(() => {
    if (cameraActive) {
      webcam.start()
    } else {
      webcam.stop()
    }
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [cameraActive])

  // The sandbox toggle is only *disabled* during a run, not forced off — if
  // it was left on, its own <video> mount would coexist with the gesture-step
  // self-view <video> below, and both bind the same webcam.videoRef. Force it
  // off the moment a run starts so only one <video> is ever mounted at a time.
  useEffect(() => {
    if (simulation.isRunning) setTestCameraOn(false)
  }, [simulation.isRunning])

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

  // Notify banner (auto-dismisses) — benign, informational only. A task
  // abort must not look like this: it uses the separate error banner
  // below, which stays up until the operator dismisses it.
  useEffect(() => {
    if (humanStep?.status !== 'notify') return
    setNotifyBanner(humanStep.description || 'Notification')
    const t = setTimeout(() => setNotifyBanner(null), 4000)
    return () => clearTimeout(t)
  }, [humanStep])

  // Error banner (task aborted) — persistent until the operator closes it,
  // distinct styling from the informational notify banner above. A stopped
  // task with no visible reason (or one that silently disappears after 4s)
  // is worse than no banner at all.
  useEffect(() => {
    if (humanStep?.status !== 'error') return
    setErrorBanner(
      humanStep.description || 'The task stopped because of a problem.',
    )
  }, [humanStep])

  // Run-result banner: without this, a run silently flips back to idle with
  // no feedback (the peak-end payoff of the whole flow), see peer message
  // text below. Skip the user's own "Simulation/Run stopped" — that's
  // already self-evident from having just pressed Stop. The reducer
  // (simulation.ts) already picks target-specific wording ("Task completed
  // on robot" vs "Simulation completed"), so simulation.message itself is
  // the final display text — no need to re-derive it from executionTarget.
  useEffect(() => {
    const wasRunning = wasRunningRef.current
    wasRunningRef.current = simulation.isRunning
    if (!wasRunning || simulation.isRunning) return
    if (
      simulation.message === 'Simulation stopped' ||
      simulation.message === 'Run stopped'
    )
      return
    setRunResult({
      ok:
        simulation.message === UI_TEXT.simulationCompleted ||
        simulation.message === UI_TEXT.taskCompletedOnRobot,
      text: simulation.message,
    })
    const t = setTimeout(() => setRunResult(null), 5000)
    return () => clearTimeout(t)
  }, [simulation.isRunning, simulation.message])

  // A fresh run starts with an empty feed again — without this the "Starting
  // simulation…" spinner would only ever show on the very first run.
  useEffect(() => {
    if (simulation.isRunning) {
      setFeedFrameLoaded(false)
      setFeedError(false)
    }
  }, [simulation.isRunning])

  // Auto-completing a gesture/voice wait makes no sense once the arm is
  // physically moving — force live (real) event handling for as long as
  // "Real robot" is selected. The switch itself is hidden in that case
  // (see the merged Run in / Events section below).
  useEffect(() => {
    if (executionTarget === 'real') setRunMode('live')
  }, [executionTarget])

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
    setErrorBanner(null) // clear any abort banner left over from a previous run
    dispatch(startSimAction(driveHardware ? 'real' : 'sim'))
    const controller = new AbortController()
    runAbortRef.current = controller
    try {
      await fetchApi({
        url: endpoints.task.simulate,
        method: MethodHTTP.POST,
        body: {
          id: Number(taskId),
          simulateEvent: runMode === 'auto',
          driveHardware,
        },
        // /api/task/simulate/ runs the whole task synchronously and returns
        // only at the end — a gesture/voice step alone can wait tens of
        // seconds, so the 60s default aborts client-side well before a real
        // run finishes and misreports it as a crash.
        timeout: 600000,
        signal: controller.signal,
        // A 400/409 (e.g. "a simulation is already running") means the run
        // was rejected, not completed — must not fall into the try's success
        // path below.
        rethrowOn: [400, 409],
      })
      if (!controller.signal.aborted) dispatch(setSimulationCompleted())
    } catch (error: any) {
      if (controller.signal.aborted) return // Stop already set the UI state
      console.error('Error running task:', error)
      dispatch(setSimulationError(error?.message || 'Error running task'))
    } finally {
      if (runAbortRef.current === controller) runAbortRef.current = null
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

  // Manual counterpart to gesture/voice/find_object as a human_action resume
  // trigger — no sensor, just a button press recorded server-side and polled
  // by the same _wait_for_condition loop.
  const handleConfirmHumanStep = async () => {
    setConfirmSending(true)
    try {
      await fetchApi({ url: endpoints.human.confirm, method: MethodHTTP.POST })
    } catch (error: any) {
      // fetchApi() already toasts the raw HTTP error — that alone doesn't
      // tell the operator what to do next: the robot is still waiting on
      // this exact step, so the fix is simply to press Confirm again.
      console.error('Error sending confirm:', error)
      setErrorBanner(
        "Your confirmation didn't go through — press Confirm again.",
      )
    } finally {
      setConfirmSending(false)
    }
  }

  const stopSimulation = () => {
    runAbortRef.current?.abort()
    dispatch(stopSimAction())
    // stop_simulation() halts the parser, Gazebo, and — if a hardware run is
    // in flight — the real arm via the halt channel. Optimistic: the UI
    // reflects "stopped" immediately rather than waiting on the round trip.
    // If the request itself fails, the arm may still be moving even though
    // the panel says otherwise — that must not stay a console-only error,
    // since the teach-pendant e-stop is the operator's real fallback here.
    fetchApi({ url: endpoints.task.stop, method: MethodHTTP.POST }).catch(
      (error: any) => {
        console.error('Error stopping simulation:', error)
        setErrorBanner(
          'The stop request failed to reach the robot — it may still be moving. ' +
            'Use the teach-pendant e-stop now if the real arm is running.',
        )
      },
    )
  }
  const handleClose = () => dispatch(toggleSim())

  // Cancel any in-flight run request if the panel unmounts mid-run (e.g. the
  // operator navigates to a different task) — otherwise it resolves later
  // and writes a stale completed/error result into the next task's state.
  useEffect(() => {
    return () => {
      runAbortRef.current?.abort()
    }
  }, [])

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

  // Esc closes the panel, matching the close button — but not while the
  // real-robot confirm dialog is open on top of it: MUI's Dialog already
  // handles Escape itself (closing just the dialog), and without this guard
  // the same keypress also closed the whole panel underneath it.
  useEffect(() => {
    if (!simOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmRealRun) handleClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [simOpen, confirmRealRun])

  // Only a fully published task can drive sim or robot. A task that is still a
  // draft — or published_with_draft (edits pending) — must not run, because the
  // runtime workspace would be the last published version and would not match
  // the draft on screen. hasUnsavedEdits closes the gap the other two miss:
  // right after an edit to an already-published task, taskStatus still reads
  // 'published' until the autosave round-trip lands (up to 2s, longer with
  // continued editing) — without this, Run would stay enabled and execute
  // the stale published version while the screen shows the new one. Webcam/
  // gesture testing stays available regardless.
  const canRun = taskStatus === 'published' && !hasUnsavedEdits

  const isHumanStepActive =
    humanStep?.status === 'started' && simulation.isRunning
  const isGestureStep = isHumanStepActive && humanStep?.condition === 'gesture'
  // Guarded by isRunning, not just status — otherwise a timeout banner from
  // the run that just ended stays pinned up through the next run/task.
  const isTimeout = humanStep?.status === 'timeout' && simulation.isRunning
  const gestureActive = activeGesture !== 'NONE' && activeGesture !== ''
  const expectedGesture =
    isHumanStepActive && humanStep?.condition === 'gesture'
      ? humanStep.value
      : null
  const gestureMatch = !!(expectedGesture && activeGesture === expectedGesture)

  // Fallback matches the backend's own default (CONDITION_TIMEOUT_S). It only
  // applies if a payload arrives without a timeout; a mismatched fallback here
  // is how the countdown came to disagree with the enforced deadline before.
  const timeoutTotal = humanStep?.timeout ?? 30
  const countdownPct = countdown !== null ? (countdown / timeoutTotal) * 100 : 0

  // The self-view (webcam mirrored into the main video area, see the
  // Simulation-view render below) replaces the old "auto-switch to the
  // camera tab" behaviour entirely — no more forced tab switch or camera
  // toggle mid-run. Events panel shows whenever a live stream is actually
  // running (sandbox test or a live-mode run) or a run is in progress.
  const eventsVisible = cameraActive || voiceActive || simulation.isRunning

  // Preflight checklist: the system already knows what a task needs (its own
  // block types, its publish status, the selected target) — say so up front
  // with an inline fix, instead of a novice discovering it only after Run
  // does nothing.
  interface PreflightIssue {
    text: string
    action?: { label: string; onClick: () => void }
  }
  const preflightIssues: PreflightIssue[] = []
  if (!canRun) {
    preflightIssues.push({
      text:
        taskStatus === 'published_with_draft'
          ? `${UI_TEXT.unpublishedChanges} — use Save & Publish in the top bar to run them.`
          : taskStatus === 'published' && hasUnsavedEdits
            ? "You just made an edit that hasn't saved yet — wait a moment, then use Save & Publish in the top bar to run it."
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
  if (taskHasHumanStep && runMode === 'auto') {
    preflightIssues.push({
      text: needsCameraOrVoice
        ? 'This task uses gesture or voice recognition. In auto mode the step completes on its own.'
        : 'This task waits for the operator. In auto mode the step completes on its own, without waiting.',
      action: {
        label: 'Switch to Execute live',
        onClick: () => setRunMode('live'),
      },
    })
  }
  if (taskNeedsVoice && runMode === 'live' && !voice.browserSupported) {
    preflightIssues.push({
      text: 'This task needs voice recognition, not supported in this browser (Chrome only) — the voice step will time out.',
    })
  }

  return (
    <Box
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby="digital-twin-title"
      // inert, not aria-hidden — aria-hidden alone left this panel's
      // (still-mounted, still-focusable) buttons reachable by Tab while
      // hidden, which is an ARIA violation; inert also removes them from
      // the tab order.
      inert={!simOpen}
      tabIndex={-1}
      sx={{
        position: 'fixed',
        right: '12px',
        top: 'calc(var(--layout-appbar-height, 56px) + 12px)',
        bottom: 'calc(var(--layout-statusbar-height, 40px) + 12px)',
        width: isWide ? '50vw' : '35vw',
        zIndex: 100,
        background: panel.surface,
        backdropFilter: 'blur(24px)',
        borderRadius: '16px',
        border: `1px solid ${panel.hairlineStrong}`,
        boxShadow: theme.customShadows.cardDark,
        transform: simOpen ? 'translateX(0)' : 'translateX(100%)',
        transition:
          'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
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
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Tooltip title={isWide ? 'Standard width' : 'Wide'}>
            <IconButton
              onClick={() => dispatch(toggleRobotPanelWidth())}
              size="small"
              aria-label={
                isWide ? 'Switch to standard width' : 'Switch to wide'
              }
              sx={{
                color: panel.iconMuted,
                '&:hover': { color: panel.white, background: panel.hover },
              }}
            >
              {isWide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </IconButton>
          </Tooltip>
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
        </Stack>
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
        {/* One banner at a time — error > timeout > notify > run result, so a
            new one never buries an older, higher-priority one underneath it. */}
        {/* ── Run-result banner (transient) ── */}
        {runResult && !errorBanner && !isTimeout && !notifyBanner && (
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
        {notifyBanner && !errorBanner && !isTimeout && (
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

        {/* ── Error banner (task aborted, persistent) ── */}
        {errorBanner && (
          <Box
            role="alert"
            aria-live="assertive"
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              padding: '10px 14px',
              background: panel.errorTint(0.1),
              border: `1px solid ${panel.errorTint(0.3)}`,
              borderRadius: '8px',
            }}
          >
            <AlertTriangle
              size={15}
              color={panel.error}
              style={{ marginTop: '1px', flexShrink: 0 }}
            />
            <Typography
              sx={{ fontSize: '0.78rem', color: panel.error, flex: 1 }}
            >
              {errorBanner}
            </Typography>
            <IconButton
              size="small"
              aria-label="Dismiss"
              onClick={() => setErrorBanner(null)}
              sx={{ padding: '2px', marginTop: '-2px' }}
            >
              <X size={14} color={panel.error} />
            </IconButton>
          </Box>
        )}

        {/* ── Timeout warning ── */}
        {isTimeout && !errorBanner && (
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
                ? `gesture "${gestureLabel(humanStep?.value)}" not detected`
                : humanStep?.condition === 'voice'
                  ? `voice command "${voiceLabel(humanStep?.value)}" not heard`
                  : humanStep?.condition === 'human_feedback'
                    ? 'operator confirmation not received'
                    : `object "${humanStep?.value}" not detected`}
              {/* Whether the run continues or stops depends on where this
                  condition was used (e.g. a bare "When" step continues; a
                  "Pause and show message" confirm now stops the task) — the
                  persistent error banner above is the authoritative signal
                  for that, so this banner only states what timed out. */}
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
              aria-label="Live view"
              value={liveView}
              exclusive
              // Locked to Task Execution during a run — that tab is also the
              // only place Stop lives, so switching away while the robot
              // (real or simulated) is moving would strand the operator
              // without it.
              disabled={simulation.isRunning}
              onChange={(_, v) => v && setLiveView(v)}
              options={[
                { value: 'simulation', label: 'Task Execution' },
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
                {isGestureStep ? (
                  // Self-view: the operator's own webcam, mirrored, replaces
                  // the robot feed for exactly this step — no tab switch, no
                  // losing the instruction/countdown overlay below. Reverts
                  // to the robot feed as soon as the step resolves.
                  <>
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
                  </>
                ) : simulation.isRunning ? (
                  <>
                    <img
                      src={MJPEG_URL}
                      alt="Robot camera feed"
                      onLoad={() => setFeedFrameLoaded(true)}
                      onError={() => setFeedError(true)}
                      style={{
                        width: '100%',
                        height: '100%',
                        // 'contain' (not 'cover') so the feed stays
                        // proportional — no crop/deformation — at both the
                        // standard and wide panel widths.
                        objectFit: 'contain',
                        display: 'block',
                        background: panel.videoBg,
                      }}
                    />
                    {!feedFrameLoaded && (
                      <Box
                        sx={{
                          position: 'absolute',
                          inset: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexDirection: 'column',
                          gap: 1,
                          background: panel.videoBg,
                        }}
                      >
                        {feedError ? (
                          <>
                            <VideoOff size={20} color={panel.errorLight} />
                            <Typography
                              sx={{
                                fontSize: '0.72rem',
                                color: panel.errorLight,
                                textAlign: 'center',
                              }}
                            >
                              Camera feed unavailable — check that the robot's
                              camera is connected and the simulation stack is
                              running.
                            </Typography>
                          </>
                        ) : (
                          <>
                            <CircularProgress
                              size={20}
                              sx={{ color: panel.primary }}
                            />
                            {/* This overlay tracks the CAMERA STREAM, not the
                                run — it sits here until the first MJPEG frame
                                arrives. It used to read "Starting
                                simulation...", which made a camera that never
                                connected look like a run stuck at step zero
                                (misread live as a frozen STATUS, 2026-07-30). */}
                            <Typography
                              sx={{ fontSize: '0.72rem', color: panel.textDim }}
                            >
                              Connecting to camera feed...
                            </Typography>
                          </>
                        )}
                      </Box>
                    )}
                  </>
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
                      sx={{ fontSize: '0.78rem', color: panel.textDim }}
                    >
                      Start a simulation to see the robot here
                    </Typography>
                  </Box>
                )}

                {/* Human step overlay — skipped for gesture steps: the whole
                    point of the self-view above is for the operator to see
                    themselves, and this scrim's blur/full-cover background
                    would hide it completely. The Required/Detected card
                    below the video already carries the instruction for that
                    case, so nothing is lost by not duplicating it here. */}
                {isHumanStepActive && !isGestureStep && (
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
                    {humanStep?.condition === 'human_feedback' && (
                      <Button
                        variant="contained"
                        size="small"
                        onClick={handleConfirmHumanStep}
                        disabled={confirmSending}
                        sx={{
                          mt: 0.5,
                          bgcolor: panel.primary,
                          '&:hover': { bgcolor: panel.primary },
                        }}
                      >
                        Confirm
                      </Button>
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
                        {gestureLabel(expectedGesture)}
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
                              : panel.textDim,
                        }}
                      >
                        {gestureLabel(activeGesture)}
                      </Typography>
                    </Box>
                  </Stack>
                </Box>
              )}

              {/* Time remaining — for every confirmation channel, not just
                  gesture. This used to be nested inside the gesture card
                  above, so an operator confirming by button, voice or object
                  detection got a spinner with no indication that the step was
                  on a deadline at all: the four channels differed in the
                  feedback they gave, not only in how they were answered. */}
              {isHumanStepActive && countdown !== null && (
                <Box sx={{ mt: 1.5 }}>
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
                      color: countdown < 10 ? panel.errorLight : panel.muted,
                      textAlign: 'right',
                    }}
                  >
                    {countdown}s
                  </Typography>
                </Box>
              )}
            </>
          ) : (
            <Box>
              {/* Sandbox intro — this tab is diagnostic, not the run path;
                  say so plainly since nothing here has a Run button to make
                  it obvious. */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: panel.primaryTint(0.06),
                  border: `1px solid ${panel.primaryTint(0.2)}`,
                  mb: 1.5,
                }}
              >
                <Info
                  size={15}
                  color={panel.primaryLight}
                  style={{ flexShrink: 0, marginTop: 1 }}
                />
                <Typography sx={{ fontSize: '0.72rem', color: panel.textDim }}>
                  Test recognition — try the webcam, gestures, and voice
                  commands before running the task. Nothing here moves the real
                  arm or changes the workspace.
                </Typography>
              </Box>

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
                    {testCameraOn && webcam.active
                      ? 'Webcam on — detecting gestures'
                      : 'Try it out any time — see how gesture recognition works before running the task'}
                  </Typography>
                </Box>
                <Tooltip
                  title={
                    testCameraOn
                      ? 'Webcam on — gestures must really happen'
                      : 'Gesture events auto-completed'
                  }
                >
                  <Switch
                    size="small"
                    checked={testCameraOn}
                    onChange={(e) => setTestCameraOn(e.target.checked)}
                    disabled={simulation.isRunning}
                    sx={{
                      ...panelSwitchOffSx,
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
                  opacity: testCameraOn ? 1 : 0.5,
                }}
              >
                <Box>
                  <Typography
                    sx={{ fontSize: '0.72rem', color: panel.textDim }}
                  >
                    Object detection
                  </Typography>
                  <Typography sx={{ fontSize: '0.62rem', color: panel.muted }}>
                    Looks for objects in this webcam feed — never affects real
                    task runs (those use the robot camera only)
                  </Typography>
                </Box>
                <Tooltip
                  title={
                    !testCameraOn
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
                      disabled={!testCameraOn || simulation.isRunning}
                      sx={{
                        ...panelSwitchOffSx,
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
                      : testVoiceOn
                        ? 'Listening — say yes / no / done / proceed'
                        : 'Try voice commands independently of the camera'}
                  </Typography>
                </Box>
                <Tooltip
                  title={
                    testVoiceOn
                      ? 'Microphone on — voice events must really happen'
                      : 'Voice events auto-completed'
                  }
                >
                  <span>
                    <Switch
                      size="small"
                      checked={testVoiceOn}
                      onChange={(e) => setTestVoiceOn(e.target.checked)}
                      disabled={simulation.isRunning || !voice.browserSupported}
                      sx={{
                        ...panelSwitchOffSx,
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

              {!testCameraOn ? (
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
                  <Typography
                    sx={{ fontSize: '0.78rem', color: panel.textDim }}
                  >
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
              {testCameraOn && webcam.devices.length > 0 && (
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
                    // The global Mui-focused override (OutlinedInput.ts) sets
                    // a light-theme indigo border + boxShadow meant for a
                    // white field — without overriding it here too, clicking
                    // into this one dark-panel select flashed that light
                    // styling on top of the dark surface.
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                      border: `1px solid ${panel.primaryLight}`,
                    },
                    '&.Mui-focused': {
                      boxShadow: `0 0 0 2px ${panel.primaryTint(0.25)}`,
                    },
                    '.MuiSvgIcon-root': { color: panel.textDim },
                  }}
                >
                  <InputLabel
                    id="dt-camera-label"
                    sx={{
                      color: panel.textDim,
                      '&.Mui-focused': { color: panel.primaryLight },
                    }}
                  >
                    Camera source
                  </InputLabel>
                  <Select
                    labelId="dt-camera-label"
                    label="Camera source"
                    value={webcam.selectedDeviceId}
                    onChange={(e) => webcam.selectDevice(e.target.value)}
                    sx={{
                      color: panel.text,
                      fontSize: '0.82rem',
                      // MuiInputBase's global override (themes/overrides/InputBase.ts)
                      // forces background:'white' on every input app-wide — fine on
                      // the light theme, but it beats this field's dark-panel text
                      // colors, making the value unreadable. !important to make sure
                      // it actually wins (plain override here left the dropdown-arrow
                      // corner still showing the forced white through).
                      background: `${panel.chromeStrong} !important`,
                      '& .MuiSelect-select': {
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        background: 'transparent !important',
                      },
                      '& .MuiSelect-icon': {
                        color: panel.textDim,
                        background: 'transparent !important',
                      },
                    }}
                    MenuProps={{
                      slotProps: {
                        paper: {
                          sx: {
                            bgcolor: panel.bg,
                            border: `1px solid ${panel.hairlineStrong}`,
                            '& .MuiMenuItem-root': {
                              color: panel.text,
                              fontSize: '0.82rem',
                              whiteSpace: 'normal',
                              wordBreak: 'break-word',
                            },
                            '& .MuiMenuItem-root:hover': {
                              bgcolor: panel.hover,
                            },
                            '& .MuiMenuItem-root.Mui-selected': {
                              bgcolor: panel.primaryTint(0.18),
                            },
                          },
                        },
                      },
                    }}
                  >
                    {webcam.devices.map((d) => (
                      <MenuItem
                        key={d.deviceId}
                        value={d.deviceId}
                        title={d.label}
                      >
                        {d.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              {/* Recognition legend — what the pipeline actually recognizes,
                  sourced from the same registry the gesture_block/
                  voice_command_block dropdowns use, so this can never drift
                  out of sync with what a task can actually check for. */}
              <Box
                sx={{
                  mt: 1.5,
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: `1px solid ${panel.hairline}`,
                  background: panel.chromeStrong,
                }}
              >
                <Typography
                  sx={{
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: panel.muted,
                    mb: 0.8,
                  }}
                >
                  Gestures ({RECOGNIZED_GESTURES.length})
                </Typography>
                <Stack
                  direction="row"
                  sx={{ flexWrap: 'wrap', gap: '6px', mb: 1.2 }}
                >
                  {RECOGNIZED_GESTURES.map((g) => (
                    <Box
                      key={g.code}
                      sx={{
                        padding: '3px 9px',
                        borderRadius: '12px',
                        border: `1px solid ${panel.hairlineStrong}`,
                        background: panel.chrome,
                      }}
                    >
                      <Typography
                        sx={{ fontSize: '0.68rem', color: panel.textDim }}
                      >
                        {g.label}
                      </Typography>
                    </Box>
                  ))}
                </Stack>

                <Typography
                  sx={{
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: panel.muted,
                    mb: 0.8,
                  }}
                >
                  Voice ({RECOGNIZED_VOICE_COMMANDS.length})
                </Typography>
                <Stack
                  direction="row"
                  sx={{ flexWrap: 'wrap', gap: '6px', mb: 1.2 }}
                >
                  {RECOGNIZED_VOICE_COMMANDS.map((v) => (
                    <Box
                      key={v.code}
                      sx={{
                        padding: '3px 9px',
                        borderRadius: '12px',
                        border: `1px solid ${panel.hairlineStrong}`,
                        background: panel.chrome,
                      }}
                    >
                      <Typography
                        sx={{ fontSize: '0.68rem', color: panel.textDim }}
                      >
                        {v.label}
                      </Typography>
                    </Box>
                  ))}
                </Stack>

                <Typography sx={{ fontSize: '0.65rem', color: panel.muted }}>
                  The robot's camera looks for objects here.
                </Typography>
              </Box>
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
                    color={gestureActive ? panel.primaryLight : panel.textDim}
                  />
                  <Typography sx={{ fontSize: '0.72rem', color: panel.muted }}>
                    Gesture
                  </Typography>
                </Stack>
                <Typography
                  sx={{
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color: gestureActive ? panel.primaryFaint : panel.textDim,
                    fontFamily: "'Geist Mono', monospace",
                  }}
                >
                  {cameraActive && webcam.active && !webcam.engineOk
                    ? 'gesture engine unavailable'
                    : cameraActive && webcam.active && webcam.error
                      ? 'capture error — retry'
                      : gestureLabel(activeGesture)}
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
                      activeDetections.length > 0
                        ? panel.success
                        : panel.textDim
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
                        : panel.textDim,
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
                    color={voice.word ? panel.primaryLight : panel.textDim}
                  />
                  <Typography sx={{ fontSize: '0.72rem', color: panel.muted }}>
                    Voice
                  </Typography>
                </Stack>
                <Typography
                  sx={{
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color: voice.word ? panel.primaryFaint : panel.textDim,
                    fontFamily: "'Geist Mono', monospace",
                  }}
                >
                  {!voice.browserSupported
                    ? 'not supported in this browser'
                    : voice.micDenied
                      ? 'microphone permission denied'
                      : voice.lastError
                        ? 'heard, but send failed — retry'
                        : voice.word || (voice.active ? 'listening…' : 'idle')}
                </Typography>
              </Stack>
            </Stack>
          </Box>
        )}

        {/* ── RUN — only on the Task Execution tab; the Test recognition
              sandbox is a diagnostic space with no run affordance at all ── */}
        {liveView === 'simulation' && (
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
                  color: panel.textDim,
                  marginBottom: '3px',
                  letterSpacing: '0.05em',
                }}
              >
                STATUS
                {/* Live-event link state. A dead SocketIO connection and a run
                    that simply isn't progressing look identical on this line
                    otherwise — that ambiguity cost two debugging rounds on
                    2026-07-30, since block_step events reaching the bridge
                    says nothing about them reaching the browser. */}
                {simulation.isRunning && !connected && (
                  <Box
                    component="span"
                    sx={{ color: panel.errorLight, ml: 1, letterSpacing: 0 }}
                  >
                    · events offline
                  </Box>
                )}
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
                Mode
              </Typography>
              <SegmentedControl
                dark
                aria-label="Mode"
                value={executionTarget}
                exclusive
                disabled={simulation.isRunning}
                onChange={(_, v) => v && setExecutionTarget(v)}
                options={[
                  {
                    value: 'sim',
                    label: UI_TEXT.simulate,
                    icon: <MonitorPlay size={13} />,
                    activeColor: panel.success,
                  },
                  {
                    value: 'real',
                    label: UI_TEXT.runOnRobot,
                    icon: <Cpu size={13} />,
                    activeColor: panel.warning,
                  },
                ]}
              />
            </Stack>

            {/* Event handling folds into the target choice instead of being a
              separate, unrelated-sounding "Events" control: on Simulation
              it's an optional convenience switch; on Real robot it's not a
              choice at all (auto-completing a physical gesture/voice wait
              makes no sense and is unsafe), so the switch is replaced by a
              plain safety notice and runMode is forced to 'live'. */}
            {executionTarget === 'sim' && !STUDY_MODE ? (
              <Stack
                direction="row"
                sx={{
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  mb: 1,
                }}
              >
                <Box>
                  <Typography
                    sx={{ fontSize: '0.78rem', color: panel.textDim }}
                  >
                    Auto-complete gesture/voice steps
                  </Typography>
                  <Typography sx={{ fontSize: '0.65rem', color: panel.muted }}>
                    Skip the camera/microphone requirements during simulation.
                  </Typography>
                </Box>
                <Switch
                  size="small"
                  checked={runMode === 'auto'}
                  disabled={simulation.isRunning}
                  onChange={(e) =>
                    setRunMode(e.target.checked ? 'auto' : 'live')
                  }
                  sx={{
                    ...panelSwitchOffSx,
                    '& .MuiSwitch-switchBase.Mui-checked': {
                      color: panel.primary,
                    },
                    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                      backgroundColor: panel.primary,
                    },
                  }}
                />
              </Stack>
            ) : executionTarget === 'sim' ? (
              // Study mode on simulation: no toggle to offer, but the absence
              // of one must not read as "the setting is missing".
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  background: panel.primaryTint(0.12),
                  border: `1px solid ${panel.primaryTint(0.4)}`,
                  mb: 1,
                }}
              >
                <AlertTriangle size={15} color={panel.primary} />
                <Typography sx={{ fontSize: '0.72rem', color: panel.textDim }}>
                  Study mode — every operator step must be performed live.
                </Typography>
              </Box>
            ) : (
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
                  Live hardware — the real robot will move. Gestures and voice
                  commands must be performed live.
                </Typography>
              </Box>
            )}

            {/* Only what this task actually uses — never both by default —
              and said up front, since the browser's own permission prompt
              gives no context for why it's asking. */}
            {runMode === 'live' && needsCameraOrVoice && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  background: panel.primaryTint(0.08),
                  border: `1px solid ${panel.primaryTint(0.25)}`,
                  mb: 1,
                }}
              >
                {taskNeedsCamera ? (
                  <Camera size={15} color={panel.primary} />
                ) : (
                  <Mic size={15} color={panel.primary} />
                )}
                <Typography sx={{ fontSize: '0.72rem', color: panel.textDim }}>
                  Run will ask for{' '}
                  {taskNeedsCamera && taskNeedsVoice
                    ? 'camera and microphone access'
                    : taskNeedsCamera
                      ? 'camera access'
                      : 'microphone access'}{' '}
                  — gestures/voice must really happen.
                </Typography>
              </Box>
            )}

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
          </Box>
        )}
      </Box>

      {/* ── Sticky footer: primary action — hidden entirely in the Test
            recognition sandbox, which has no run affordance ── */}
      {liveView === 'simulation' && (
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
                : executionTarget === 'real'
                  ? {
                      // Amber = "leads to the real robot moving" — same
                      // semantic as the "Live hardware" warning banner below
                      // and the Mode selector's Run on robot pill. White
                      // text fails here (2.15:1) — warning.contrastText is
                      // the theme's own designated ink pairing (7.94:1).
                      background: panel.warning,
                      color: theme.palette.warning.contrastText,
                      '&:hover': {
                        background: panel.warningDark,
                        boxShadow: 'none',
                      },
                    }
                  : {
                      // Green = "twin only" — same semantic as the
                      // reassurance banner below. success.contrastText ink
                      // (6.72:1) — white fails here too (2.54:1).
                      background: panel.success,
                      color: theme.palette.success.contrastText,
                      '&:hover': {
                        background: panel.successDark,
                        boxShadow: 'none',
                      },
                    }),
              '&.Mui-disabled': {
                background: panel.primaryTint(0.18),
                // Was panel.iconMuted (white @ 40%) = 3.65:1 on this tint —
                // WCAG-exempt (disabled control) but still hard to read as
                // the page's most prominent button. panel.textDim clears
                // AA (6.04:1) while staying visually distinct from the
                // solid-indigo enabled state.
                color: panel.textDim,
              },
            }}
          >
            {simulation.isRunning
              ? 'Stop'
              : executionTarget === 'real'
                ? UI_TEXT.runOnRobot
                : UI_TEXT.startSimulation}
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
      )}

      {/* ── Confirm real-robot run ── */}
      <ConfirmDialog
        open={confirmRealRun}
        title="Run on the real robot?"
        message="The physical arm will move for real, not just in the simulation. Before confirming: make sure the area around the robot is clear. If anything looks wrong once it starts, use the red e-stop button on the teach pendant — that stops the arm immediately."
        confirmLabel={UI_TEXT.runOnRobot}
        tone="danger"
        confirmOnEnter={false}
        onConfirm={confirmAndRun}
        onCancel={() => setConfirmRealRun(false)}
      />
    </Box>
  )
}
