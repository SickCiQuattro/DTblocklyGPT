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
  ScanEye,
  Clock,
  User,
} from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'
import * as Blockly from 'blockly/core'
import { useTheme } from '@mui/material/styles'
import useSWR from 'swr'

import { TaskStatus } from 'pages/tasks/types'
import { useAppSelector } from 'store/reducers'
import { toggleSim, toggleRobotPanelWidth } from 'store/reducers/task'
import {
  RECOGNIZED_GESTURES,
  RECOGNIZED_VOICE_COMMANDS,
  NOTHING_RECOGNIZED,
  gestureLabel,
  spokenExample,
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
  setSimulationMessage,
} from 'store/reducers/simulation'
import { useRosEvents } from 'hooks/useRosEvents'
import { useWebcamVision } from 'hooks/useWebcamVision'
import { useVoiceCommand } from 'hooks/useVoiceCommand'
import { MacroWorkspaces, recognitionNeedsOf } from 'utils/runRecognitionNeeds'
import {
  highlightExecutingBlock,
  scrollRunningBlockIntoView,
  clearExecutingHighlights,
} from 'features/blockly/utils/blockHighlight'
import { blockMetaByType } from 'features/blockly/toolbox/toolboxRegistry'
import { SegmentedControl } from 'components/SegmentedControl'
import { ConfirmDialog } from 'components/ConfirmDialog'

import { gestureIcon } from 'constants/gestureIcons'
import { panel, panelType } from './digitalTwin/panelTokens'
import {
  MESSAGE_TTL_MS,
  PanelMessage,
  type RuntimeTone,
} from './digitalTwin/PanelMessage'

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
// The video frame's geometry. Two values depend on each other here, so they
// are named rather than repeated.
//
// An absolutely-positioned `inset: 0` child fills its ancestor's PADDING box,
// and the padding box of a bordered rounded rect has a corner radius of
// (outer radius − border width) — not the outer radius. `borderRadius:
// 'inherit'` handed the overlays the OUTER 10px inside a 9px curve, so each
// corner was over-rounded and let a sliver of the frame through.
const VIDEO_RADIUS_PX = 10
const VIDEO_BORDER_PX = 1
const VIDEO_INNER_RADIUS = `${VIDEO_RADIUS_PX - VIDEO_BORDER_PX}px`

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
  /** Scroll the canvas to the running step when it goes off-screen.
   *  Opt-in (viewSettings.followRunningBlock); off by default. */
  followRunningBlock?: boolean
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
      fontSize: panelType.micro,
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
  followRunningBlock = false,
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
  // indistinguishable from real data after the fact.
  //
  // 'live' is also the default everywhere else, not just under STUDY_MODE. The
  // old 'auto' default meant a task built with "resume on a thumbs up" did not
  // wait for one: the simulation quietly answered on the operator's behalf and
  // ran straight past the step they had just programmed. That teaches the wrong
  // model of what the robot does, and it is precisely the prediction the study
  // asks participants to make about the physical arm. Skipping the wait is a
  // deliberate shortcut for working without a camera, so it is opt-IN.
  const [runMode, setRunMode] = useState<'auto' | 'live'>('live')
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
  // Milliseconds left, not whole seconds: the bar reads this directly, so it
  // moves ten times a second instead of stepping 3.3% once a second. The
  // number on screen still shows whole seconds.
  const [remainingMs, setRemainingMs] = useState<number | null>(null)
  const [confirmSending, setConfirmSending] = useState(false)
  // True from the moment Stop is pressed until the server says the previous
  // run has actually let go of the world. Not a timer: the teardown can be a
  // gz subprocess, a blocking b-CAP move on the real arm, or a bridge POST
  // waiting out its own timeout, and "long enough" changes with the machine
  // and with what the run was doing when it was stopped.
  const [stopping, setStopping] = useState(false)
  const stoppingPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Slot 1 (over the video), not a banner: a "Show message" is authored content
  // addressed to the operator while they are watching the arm, and a banner at
  // the top of a scrollable body is exactly where they are not looking.
  const [notifyPill, setNotifyPill] = useState<string | null>(null)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<{
    ok: boolean
    text: string
    /** Open consequence — stays until dismissed. See MESSAGE_TTL_MS. */
    sticky?: boolean
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
    macroContext,
    resetMacroContext,
    connected,
  } = useRosEvents()
  const webcam = useWebcamVision()

  // ── Live block-execution highlight ──────────────────────────────────────────
  // Per-step reaction: highlight the running block (+ its object/location),
  // clearing the previous one. No-ops if the simulated workspace differs from
  // the one on screen (getBlockById returns null).
  useEffect(() => {
    if (!workspace || !blockStep) return

    // Events for a block that is not on THIS canvas are ignored outright — not
    // treated as "nothing is running".
    //
    // A Saved Task executes blocks belonging to another task's workspace, and
    // those emit their own start/end with ids this canvas has never seen.
    // Clearing on them wiped the macro block's own highlight a few milliseconds
    // after it appeared, so a running Saved Task looked like it was doing
    // nothing at all — the highlight was being switched off by its own
    // children.
    // While a Saved Task is running, its block stays lit and inner events are
    // ignored entirely. Two separate reasons, both fatal on their own:
    //   - the inner blocks are not on this canvas, so highlighting them is a
    //     no-op while CLEARING on them switched the macro's own glow off;
    //   - the macro's own event rarely survives a polling burst, so waiting for
    //     it to re-arrive would leave the block dark most of the time.
    // macroContext is maintained at socket level and does survive.
    if (macroContext) {
      clearExecutingHighlights(workspace)
      highlightExecutingBlock(workspace, macroContext.blockId)
      if (followRunningBlock) {
        scrollRunningBlockIntoView(workspace, macroContext.blockId)
      }
      return
    }

    if (!workspace.getBlockById(blockStep.blockId)) return

    clearExecutingHighlights(workspace)
    if (blockStep.phase === 'start') {
      highlightExecutingBlock(workspace, blockStep.blockId)
      if (followRunningBlock) {
        scrollRunningBlockIntoView(workspace, blockStep.blockId)
      }
    }
  }, [blockStep, macroContext, workspace, followRunningBlock])

  // Live STATUS feedback — block_step events already exist server-side
  // (_notify_block_step in simulate.py) but nothing consumed them before, so
  // the line sat frozen on "Starting…" for the whole run, which can
  // legitimately take minutes.
  //
  // Driven by ANY block_step, not only 'end'. Requiring 'end' meant a run
  // whose events all arrived as 'start' (or whose only surviving event in a
  // polled burst was a 'start') never moved off "Starting simulation…" —
  // indistinguishable from a run that never began (confirmed live 2026-07-30).
  useEffect(() => {
    if (!simulation.isRunning || !blockStep) return

    // While a Saved Task runs, its own line wins over the inner block's name:
    // those inner blocks belong to another task's workspace, so naming them
    // here told the operator nothing about where the run actually was.
    // macroContext comes from useRosEvents rather than from `blockStep`
    // because the polling transport collapses each burst to its LAST event,
    // which is always an inner block — the macro's own event never survived.
    //
    // The line carries no run-wide "N done" tally. It had no denominator, so
    // "Pick up — 1 done" answered a question nobody asked while sitting next
    // to the macro's "step 3 of 3", which does have one: two different
    // vocabularies for progress on the same line. What is running is the
    // question this line answers; where the run is, the highlighted block on
    // the canvas already shows.
    dispatch(
      setSimulationMessage(
        macroContext
          ? `Saved task “${macroContext.name}” — step ${macroContext.step} of ${macroContext.total}`
          : humanizeBlockType(blockStep.blockType),
      ),
    )
  }, [blockStep, macroContext, simulation.isRunning, dispatch])

  // A condition wait (when_block on gesture/voice/confirm/find_object) can
  // legitimately hold the STATUS line frozen for its whole timeout (up to
  // 30s+): when_block itself never emits a block_step (only actions do), so
  // if the condition never resolves, nothing in the effect above ever fires
  // and the operator sees "Starting simulation…" the entire time even though
  // the robot is genuinely waiting on them. human_step 'started' already
  // carries condition/value for exactly this wait — surface it on the same
  // STATUS line instead of only in the separate countdown overlay.
  // Composed once and reused by the STATUS line and the overlay, so the two
  // never drift. The channel is the part that matters: "waiting" alone does
  // not tell the operator what they are supposed to do.
  const humanStepLabel = useMemo(() => {
    if (humanStep?.status !== 'started') return null
    switch (humanStep.condition) {
      case 'gesture':
        return `Waiting for gesture "${gestureLabel(humanStep.value)}"…`
      case 'voice': {
        // The word to SAY, not just the block's label: the recognizer listens
        // in SPEECH_LANG, so an English label in front of an Italian-speaking
        // operator names the step without telling them what to utter.
        const say = spokenExample(humanStep.value)
        const label = voiceLabel(humanStep.value)
        return say && say.toLowerCase() !== label.toLowerCase()
          ? `Waiting for voice command "${label}" — say “${say}”…`
          : `Waiting for voice command "${label}"…`
      }
      case 'object':
        return `Waiting to find "${humanStep.value}"…`
      default:
        return 'Waiting for operator confirmation…'
    }
  }, [humanStep])

  useEffect(() => {
    if (!simulation.isRunning || !humanStepLabel) return
    dispatch(setSimulationMessage(humanStepLabel))
  }, [humanStepLabel, simulation.isRunning, dispatch])

  // Safety-net cleanup when the run stops (the last block's `end` also clears).
  // Kept separate so `isRunning` isn't a dependency of the per-step effect.
  // resetMacroContext belongs here rather than in the hook's own event
  // handling: a Stop, or any abort inside a Saved Task, means the macro's
  // 'end' event never fires, and the stale context would then hijack the next
  // run's highlight and STATUS line.
  useEffect(() => {
    if (!simulation.isRunning) {
      if (workspace) clearExecutingHighlights(workspace)
      resetMacroContext()
    }
  }, [simulation.isRunning, workspace, resetMacroContext])

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
  //
  // Saved Tasks are followed, not just the blocks on this canvas. Their steps
  // live in another task's workspace, so scanning the canvas alone reported
  // "needs nothing" for a task whose only gesture step sits inside a macro:
  // the webcam never started and the step waited its whole timeout while the
  // operator gestured at a camera that was off. Same for voice.
  //
  // The macro workspaces come from the same SWR key the editor already holds
  // (graphic.macroList returns published_workspace), so this costs no request.
  const { data: dataMacros = [] } = useSWR<
    { id: number; published_workspace?: unknown }[],
    Error
  >({ url: endpoints.graphic.macroList })

  const macroWorkspaces = useMemo(() => {
    const map: MacroWorkspaces = new Map()
    dataMacros.forEach((m) => {
      if (m?.id !== undefined) map.set(`${m.id}`, m.published_workspace)
    })
    return map
  }, [dataMacros])

  const runNeedsLive = useMemo(
    () => recognitionNeedsOf(workspace, macroWorkspaces),
    // eslint-disable-next-line @eslint-react/exhaustive-deps
    [workspace, macroWorkspaces, simulation.isRunning],
  )
  const taskNeedsCameraLive = runNeedsLive.camera
  const taskNeedsVoiceLive = runNeedsLive.voice

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
  // Follows Saved Tasks, same as the camera/voice needs above and for the same
  // reason: a task whose only operator step is inside a macro would otherwise
  // never warn that auto mode is about to answer it.
  const taskHasHumanStep = runNeedsLive.humanStep

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

  // Countdown ticker, driven by a DEADLINE rather than by decrementing a
  // counter. A subtracting counter drifts: setInterval fires late under load,
  // and this panel re-renders at several Hz during a live run, so the number
  // on screen slowly fell behind the deadline the backend actually enforces.
  // Reading the clock each tick cannot drift, and it also survives a tab
  // being throttled in the background.
  useEffect(() => {
    if (humanStep?.status === 'started' && humanStep.timeout) {
      const deadline = performance.now() + humanStep.timeout * 1000
      const tick = () =>
        setRemainingMs(Math.max(0, deadline - performance.now()))
      tick()
      if (countdownRef.current) clearInterval(countdownRef.current)
      countdownRef.current = setInterval(tick, 100)
    } else {
      if (countdownRef.current) clearInterval(countdownRef.current)
      setRemainingMs(null)
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [humanStep?.status, humanStep?.timeout])

  // Step completed flash — an event with nothing left to handle, so it takes
  // the shared transient lifetime rather than a hand-picked 2s.
  useEffect(() => {
    if (humanStep?.status !== 'completed') return
    setStepCompleted(true)
    const t = setTimeout(() => setStepCompleted(false), MESSAGE_TTL_MS)
    return () => clearTimeout(t)
  }, [humanStep])

  // "Show message" — authored text, shown over the live view (slot 1), because
  // that is where the operator is looking during a run. It used to be a banner
  // at the top of the scroll body: a plain flex child with no sticky and no
  // scroll-into-view, so it could appear off-screen and delete itself four
  // seconds later, and mounting it shoved the whole video down ~44px mid-run.
  useEffect(() => {
    if (humanStep?.status !== 'notify') return
    setNotifyPill(humanStep.description || 'Notification')
    const t = setTimeout(() => setNotifyPill(null), MESSAGE_TTL_MS)
    return () => clearTimeout(t)
  }, [humanStep])

  // Task aborted — an event with an open consequence, so it stays until the
  // operator dismisses it. A stopped task with no visible reason (or one that
  // silently disappears) is worse than no message at all.
  useEffect(() => {
    if (humanStep?.status !== 'error') return
    setErrorBanner(
      humanStep.description || 'The task stopped because of a problem.',
    )
  }, [humanStep])

  // Run result: without this, a run silently flips back to idle with no
  // feedback (the peak-end payoff of the whole flow). Skip the operator's own
  // "Simulation/Run stopped" — the stop handler owns that message, because only
  // it knows whether the robot actually acknowledged the halt. The reducer
  // (simulation.ts) already picks target-specific wording ("Task completed on
  // robot" vs "Simulation completed"), so simulation.message is the final
  // display text — no need to re-derive it from executionTarget.
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
  }, [simulation.isRunning, simulation.message])

  // One place expires a run result, whoever set it — the effect above or the
  // stop handler. Per-setter timers are how "Simulation stopped." would have
  // stayed on screen forever: the handler set it, and only the effect had a
  // timer. `sticky` opts out, for a result the operator must acknowledge.
  useEffect(() => {
    if (!runResult || runResult.sticky) return
    const t = setTimeout(() => setRunResult(null), MESSAGE_TTL_MS)
    return () => clearTimeout(t)
  }, [runResult])

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

  /** Poll until the run lock is free, then let Run light up again. */
  const waitForRunToRelease = () => {
    if (stoppingPollRef.current) clearInterval(stoppingPollRef.current)
    setStopping(true)
    const started = Date.now()
    const check = async () => {
      try {
        const res: { running?: boolean } | undefined = await fetchApi({
          url: endpoints.task.runState,
          method: MethodHTTP.GET,
        })
        // Give up waiting after 30s rather than leaving Run disabled forever
        // on a teardown that never reports done — a stuck button is worse
        // than a 409 the operator can retry past.
        if (res?.running === false || Date.now() - started > 30000) {
          if (stoppingPollRef.current) clearInterval(stoppingPollRef.current)
          stoppingPollRef.current = null
          setStopping(false)
        }
      } catch {
        // The state probe failing is not a reason to strand the button.
        if (stoppingPollRef.current) clearInterval(stoppingPollRef.current)
        stoppingPollRef.current = null
        setStopping(false)
      }
    }
    void check()
    stoppingPollRef.current = setInterval(() => void check(), 500)
  }

  useEffect(
    () => () => {
      if (stoppingPollRef.current) clearInterval(stoppingPollRef.current)
    },
    [],
  )

  const stopSimulation = () => {
    runAbortRef.current?.abort()
    dispatch(stopSimAction())
    waitForRunToRelease()
    // stop_simulation() halts the parser, Gazebo, and — if a hardware run is
    // in flight — the real arm via the halt channel. Optimistic: the UI
    // reflects "stopped" immediately rather than waiting on the round trip.
    // If the request itself fails, the arm may still be moving even though
    // the panel says otherwise — that must not stay a console-only error,
    // since the teach-pendant e-stop is the operator's real fallback here.
    fetchApi({ url: endpoints.task.stop, method: MethodHTTP.POST })
      .then(() => {
        // Say it succeeded, in the same place the failure lands. This used to
        // be a global toast while the failure was an in-panel banner: the two
        // halves of one button press arrived in two different parts of the
        // screen, and the operator who just pressed Stop is looking at one.
        //
        // The STATUS line reads "stopped" the moment the button is pressed —
        // optimistically, before the round trip — so on its own it cannot tell
        // the operator whether the robot actually got the message. On a
        // hardware run that difference is the whole point, and the sentence
        // names what the arm is still doing: a halt stops motion, it does not
        // open the gripper, so anything held stays held.
        //
        // Sticky on hardware, transient on the twin — the duration rule: an
        // arm still gripping something is an open consequence, a stopped
        // simulation is not.
        setRunResult(
          executionTarget === 'real'
            ? {
                ok: true,
                text: 'Robot halted. It is still holding whatever was in the gripper.',
                sticky: true,
              }
            : { ok: true, text: 'Simulation stopped' },
        )
      })
      .catch((error: unknown) => {
        console.error('Error stopping simulation:', error)
        // Prefer the server's own wording when it has any. Two different
        // things reach this handler and they call for different actions: the
        // request never arrived, or it arrived and the arm refused to confirm
        // the halt. The backend distinguishes them; stating only the first
        // would describe the wrong failure half the time.
        const serverMessage = (
          error as { response?: { data?: { message?: string } } } | null
        )?.response?.data?.message
        setErrorBanner(
          serverMessage ||
            'The stop request failed to reach the robot — it may still be moving. ' +
              'Use the teach-pendant e-stop now if the real arm is running.',
        )
      })
  }
  const handleClose = () => dispatch(toggleSim())

  // Unmounting mid-run (e.g. the operator navigates to a different task).
  //
  // Aborting the request only drops OUR side of the conversation — the run
  // keeps going on the server, and the arm with it, because stopping is a
  // separate POST. The next workspace mount then dispatches resetSimulation(),
  // so every indicator reads "Idle" while the robot is still working through
  // the previous task. Sending the stop is what makes the UI's claim true.
  //
  // A ref, not `simulation.isRunning` in a dependency array: this effect must
  // run its cleanup exactly once, at unmount, with whatever the state is then.
  const isRunningRef = useRef(simulation.isRunning)
  isRunningRef.current = simulation.isRunning
  useEffect(() => {
    return () => {
      runAbortRef.current?.abort()
      if (!isRunningRef.current) return
      // Fire-and-forget by necessity — the component is going away and there
      // is nowhere left to show an error. The server-side abort machinery is
      // what actually halts Gazebo and the arm; this is the request that
      // starts it.
      void fetchApi({
        url: endpoints.task.stop,
        method: MethodHTTP.POST,
      }).catch((error: unknown) => {
        console.error('Stop-on-unmount failed:', error)
      })
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
  // The backend's own wire value is 'object' (see _condition_payload in
  // simulate.py) — not 'find_object', which is the BLOCK type. Guarding on
  // both would put a branch here that can never be taken.
  const isObjectStep = isHumanStepActive && humanStep?.condition === 'object'
  // Guarded by isRunning, not just status — otherwise a timeout banner from
  // the run that just ended stays pinned up through the next run/task.
  const isTimeout = humanStep?.status === 'timeout' && simulation.isRunning
  const gestureActive = activeGesture !== 'NONE' && activeGesture !== ''
  const expectedGesture =
    isHumanStepActive && humanStep?.condition === 'gesture'
      ? humanStep.value
      : null
  const gestureMatch = !!(expectedGesture && activeGesture === expectedGesture)
  // The mark on the human-step overlay: the channel this step is waiting on,
  // never a hand.
  //
  // It WAS a hand, harmlessly, until `Hand` was given a second job as the icon
  // for the OPEN_HAND gesture. After that, a step asking the operator to press
  // a button showed them an open palm — which in this panel's own vocabulary
  // now reads as "make this hand shape". The wrong instruction, in the one
  // place the operator is under a deadline.
  //
  // Gesture and object steps never reach this overlay (they are excluded so
  // the camera stays visible), so the channels here are exactly these three
  // plus a bare wait. Mic and Clock are the marks this panel and the chat
  // preview already use for voice and time; `User` is the "Pause and show
  // message" block's own icon in the toolbox, which ties the runtime moment
  // back to the block on the canvas.
  const WaitIcon =
    humanStep?.condition === 'voice'
      ? Mic
      : humanStep?.condition === 'timer'
        ? Clock
        : User
  // Both of these name a gesture, so both must draw THAT gesture. `Hand` is
  // the fallback only while nothing is detected, where there is no value to
  // misread. Hoisted out of the JSX: a component identity built inside the
  // markup is a fresh type on every render, which remounts the icon.
  const EventsGestureIcon =
    (gestureActive && gestureIcon(activeGesture)) || Hand
  const SandboxGestureIcon = gestureIcon(webcam.gesture) || Hand
  const RequiredGestureIcon = gestureIcon(expectedGesture)
  const DetectedGestureIcon = gestureIcon(gestureActive ? activeGesture : null)

  // Put focus on the Confirm button the moment a button-confirmed human step
  // starts. The STATUS line already announces the wait, but announcing it is
  // only half: the step is on a timer, and a keyboard user who has to hunt
  // through the panel for the button can run out of clock while being told
  // what to do. This is the one place in the app where reachability and
  // timing interact.
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null)
  const needsButtonConfirm =
    isHumanStepActive && humanStep?.condition === 'human_feedback'
  useEffect(() => {
    if (needsButtonConfirm) confirmButtonRef.current?.focus()
  }, [needsButtonConfirm])

  // ── Slot 3: OUTCOME ────────────────────────────────────────────────────
  // One region, one message, priority = the order of this array. It replaces
  // four near-identical banner blocks each guarded by a hand-maintained chain
  // of `&& !otherBanner` conditions — a chain that had to be edited in four
  // places to add a fifth message, and silently allowed two to stack if one
  // was missed.
  //
  // `RuntimeTone` has no amber: see PanelMessage. That is why the timeout is
  // info here and was amber before — it states what did not happen, it does
  // not claim the arm is involved. When a timeout *does* abort the run, the
  // abort itself arrives as `errorBanner` and outranks it in this very list.
  const outcomeBanner: {
    key: string
    tone: RuntimeTone
    text: string
    onDismiss?: () => void
  } | null =
    [
      errorBanner && {
        key: 'error',
        tone: 'danger' as const,
        text: errorBanner,
        onDismiss: () => setErrorBanner(null),
      },
      isTimeout && {
        key: 'timeout',
        tone: 'info' as const,
        text: `Timeout: ${
          humanStep?.condition === 'gesture'
            ? `gesture "${gestureLabel(humanStep?.value)}" not detected`
            : humanStep?.condition === 'voice'
              ? `voice command "${voiceLabel(humanStep?.value)}" not heard`
              : humanStep?.condition === 'human_feedback'
                ? 'operator confirmation not received'
                : `object "${humanStep?.value}" not detected`
        }`,
      },
      runResult && {
        key: 'result',
        tone: (runResult.ok ? 'success' : 'danger') as RuntimeTone,
        text: runResult.text,
        ...(runResult.sticky ? { onDismiss: () => setRunResult(null) } : {}),
      },
    ].find(Boolean) || null

  // ── Slot 1: NOW ────────────────────────────────────────────────────────
  // Same pattern as the outcome banner: priority is the order of the array,
  // and the slot holds one thing. Authored text outranks the panel's own ack.
  const videoPill: { tone: 'info' | 'success'; text: string } | null =
    [
      notifyPill && { tone: 'info' as const, text: notifyPill },
      stepCompleted && { tone: 'success' as const, text: 'Step completed' },
    ].find(Boolean) || null

  // Fallback matches the backend's own default (CONDITION_TIMEOUT_S). It only
  // applies if a payload arrives without a timeout; a mismatched fallback here
  // is how the countdown came to disagree with the enforced deadline before.
  const timeoutTotal = humanStep?.timeout ?? 30
  const countdown = remainingMs === null ? null : Math.ceil(remainingMs / 1000)
  const countdownPct =
    remainingMs === null ? 0 : (remainingMs / (timeoutTotal * 1000)) * 100
  // Thresholds as FRACTIONS of this step's own budget, not as absolute
  // seconds. The old `countdown < 10` / `< 20` were tuned to a 30s timeout and
  // silently mistune themselves the moment CONDITION_TIMEOUT_S changes: at 15s
  // the bar would open amber and spend two thirds of its life red, warning
  // permanently about nothing.
  const countdownIsCritical = countdownPct <= 20

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
    /** Reserved amber: only an issue about the physical arm. Default is info. */
    tone?: 'hardware'
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
      // The one pre-flight issue that IS about the arm, so the one that keeps
      // amber.
      tone: 'hardware',
      text:
        hwStatus === null
          ? 'Checking the robot connection…'
          : 'Robot not connected — check the hardware connection before running.',
    })
  }
  // Worded with the switch's own name. "Execute live" / "auto mode" were the
  // names of an earlier control and survived its rename, so this notice named
  // a setting the operator could no longer find anywhere on screen.
  if (taskHasHumanStep && runMode === 'auto') {
    preflightIssues.push({
      text: needsCameraOrVoice
        ? 'This task uses gesture or voice recognition, but human steps are set to be answered automatically — the step will complete without you.'
        : 'This task waits for the operator, but human steps are set to be answered automatically — it will not wait.',
      action: {
        label: 'Answer them myself',
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
      // A landmark, not a dialog: the editor column shrinks to
      // `calc(100% - 35vw)` while this is open, so it does not overlay the
      // page, and there is no focus trap — announcing "dialog" promised a
      // boundary Tab walks straight out of. As a landmark it is reachable by
      // landmark key at any time, which matters because the run status and the
      // human-step prompt live here and are needed *during* a run.
      role="region"
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
              fontSize: panelType.body,
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
                fontSize: panelType.micro,
                color: connected ? panel.textDim : panel.warningLight,
              }}
            >
              {connected ? 'Connected' : 'Offline'}
            </Typography>
          </Stack>
          {/* The panel reserves amber for one meaning — the physical arm is
              involved — and enforces it in the type system. Then it put every
              amber cue inside the `!simulation.isRunning` gate, so all of them
              unmounted at the exact moment the arm started moving. The one
              period the meaning applies was the one period it was not on
              screen; what survived was a 10.5px grey caption.

              This chip lives in the header, outside every gate, and intensifies
              rather than disappears once the run starts. */}
          {executionTarget === 'real' && (
            <Stack
              direction="row"
              spacing={0.5}
              sx={{
                alignItems: 'center',
                px: 1,
                py: 0.25,
                borderRadius: '999px',
                bgcolor: panel.warningTint(simulation.isRunning ? 0.24 : 0.12),
                border: `1px solid ${panel.warningTint(simulation.isRunning ? 0.7 : 0.4)}`,
              }}
            >
              <Cpu size={12} color={panel.warning} />
              <Typography
                sx={{
                  fontSize: panelType.micro,
                  fontWeight: 600,
                  color: panel.warningLight,
                }}
              >
                {simulation.isRunning ? 'Arm live' : 'Real robot'}
              </Typography>
            </Stack>
          )}
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
              width: 36,
              height: 36,
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
        {/* ── Slot 3: OUTCOME — one region, one message ──
            `sticky` rather than a plain flex child: these appear mid-run and
            at run end, and a banner that lives at the top of a scrollable body
            is off-screen the moment the operator has scrolled down to STATUS
            or the Events readouts. The negative `top` cancels the body's own
            14px padding so it pins flush. */}
        {outcomeBanner && (
          <Box
            sx={{
              position: 'sticky',
              top: '-14px',
              zIndex: 2,
              paddingTop: '14px',
              marginTop: '-14px',
              background: panel.surface,
            }}
          >
            <PanelMessage
              key={outcomeBanner.key}
              tone={outcomeBanner.tone}
              announce
              onDismiss={outcomeBanner.onDismiss}
            >
              {outcomeBanner.text}
            </PanelMessage>
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
            {/* The span is load-bearing: a disabled child swallows the
                pointer events a Tooltip listens for, so without it the
                explanation never appears — which is the whole point here.
                Saying WHY a control is locked is the other half of showing
                that it is; the disabled styling lives in SegmentedControl. */}
            <Tooltip
              title={
                simulation.isRunning
                  ? 'Locked while the robot is running — Stop lives on this tab'
                  : ''
              }
            >
              <span>
                <SegmentedControl
                  dark
                  aria-label="Live view"
                  value={liveView}
                  exclusive
                  // Locked to the Robot view during a run — that tab is also
                  // the only place Stop lives, so switching away while the
                  // robot (real or simulated) is moving would strand the
                  // operator without it.
                  disabled={simulation.isRunning}
                  onChange={(_, v) => v && setLiveView(v)}
                  options={[
                    { value: 'simulation', label: UI_TEXT.liveViewRobot },
                    { value: 'camera', label: UI_TEXT.liveViewSandbox },
                  ]}
                />
              </span>
            </Tooltip>
          </Stack>

          {liveView === 'simulation' ? (
            <>
              <Box
                sx={{
                  position: 'relative',
                  width: '100%',
                  aspectRatio: '4/3',
                  background: panel.videoBg,
                  borderRadius: `${VIDEO_RADIUS_PX}px`,
                  overflow: 'hidden',
                  border: `${VIDEO_BORDER_PX}px solid ${panel.hairlineStrong}`,
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
                          // Ground: this covers the operator's own webcam
                          // picture, which is a lit room. Without it the text
                          // measured 2.56:1 on a bright frame.
                          background: panel.overlayScrim,
                          borderRadius: VIDEO_INNER_RADIUS,
                        }}
                      >
                        <CircularProgress
                          size={20}
                          sx={{ color: panel.primary }}
                        />
                        <Typography
                          sx={{
                            fontSize: panelType.small,
                            color: panel.textDim,
                          }}
                        >
                          Starting camera…
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
                          background: panel.overlayScrim,
                          borderRadius: VIDEO_INNER_RADIUS,
                        }}
                      >
                        <VideoOff size={22} color={panel.errorLight} />
                        <Typography
                          sx={{
                            fontSize: panelType.small,
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
                                fontSize: panelType.small,
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
                              sx={{
                                fontSize: panelType.small,
                                color: panel.textDim,
                              }}
                            >
                              Connecting to camera feed…
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
                      sx={{ fontSize: panelType.body, color: panel.textDim }}
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
                    case, so nothing is lost by not duplicating it here.

                    Skipped for an OBJECT wait too, for exactly the same
                    reason and it took longer to notice: the step says "show
                    the camera a blue tube", and the panel answered by blurring
                    the camera's picture. Aiming an object at a lens is a
                    closed loop — you move it and watch what happens — and
                    covering the feed turns it into guessing until the 30s
                    timeout fires. The Objects readout that would close the
                    loop instead lives in EVENTS, below the fold on a laptop.
                    These steps get the bar below rather than a scrim. */}
                {isHumanStepActive && !isGestureStep && !isObjectStep && (
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      background: panel.overlayScrim,
                      // No backdrop-filter. It was the visible half of the
                      // corner defect: Chromium paints a blurred backdrop
                      // clipped to the element's SQUARE border box, not to its
                      // border-radius, so each corner showed a bright blurred
                      // crescent of the frame underneath — exactly the white
                      // slivers. And it was buying nothing: at 0.92 opacity
                      // only 8% of the backdrop comes through, so the blur was
                      // decoration paying for a compositor layer and a bug.
                      borderRadius: VIDEO_INNER_RADIUS,
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
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        background: panel.primaryTint(0.15),
                        border: `2px solid ${panel.primaryTint(0.5)}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <WaitIcon size={17} color={panel.primaryFaint} />
                    </Box>
                    <Typography
                      sx={{
                        fontSize: panelType.lead,
                        fontWeight: 600,
                        textAlign: 'center',
                        color: panel.text,
                        lineHeight: 1.4,
                      }}
                    >
                      {humanStep?.description || 'Human action required'}
                    </Typography>
                    {/* Names the channel instead of a bare "waiting", so what
                        is shown matches what the STATUS line announces. Not a
                        live region itself: that one lives on the STATUS line,
                        and a second one here would say the same sentence
                        twice. */}
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
                        sx={{ fontSize: panelType.body, color: panel.text }}
                      >
                        {humanStepLabel ?? 'Waiting for operator confirmation…'}
                      </Typography>
                      {/* The seconds belong next to the thing they constrain.
                          The countdown card lives below the video, ~250px from
                          the Confirm button at this panel width — two fixations
                          for a person who has thirty seconds and is also
                          watching an arm. The bar down there stays: it is the
                          shape of time passing. This is the number. */}
                      {countdown !== null && (
                        <Typography
                          sx={{
                            fontSize: panelType.body,
                            fontFamily: "'Geist Mono', monospace",
                            fontWeight: 600,
                            color: countdownIsCritical
                              ? panel.errorLight
                              : panel.textDim,
                          }}
                        >
                          {countdown}s
                        </Typography>
                      )}
                    </Stack>
                    {humanStep?.condition === 'human_feedback' && (
                      <Button
                        ref={confirmButtonRef}
                        variant="contained"
                        onClick={handleConfirmHumanStep}
                        disabled={confirmSending}
                        startIcon={
                          confirmSending ? (
                            <CircularProgress size={16} color="inherit" />
                          ) : (
                            <CheckCircle2 size={18} />
                          )
                        }
                        sx={{
                          mt: 1,
                          minWidth: 200,
                          minHeight: 48,
                          fontSize: panelType.body,
                          fontWeight: 600,
                          textTransform: 'none',
                          // NO bgcolor override. The theme's containedPrimary
                          // is primary.dark precisely because primary.main
                          // renders white text at 4.47:1 and fails AA
                          // (themes/overrides/Button.ts) — the override that
                          // used to be here reintroduced that exact failure on
                          // the one control an operator must find under a
                          // 30-second deadline. primary.dark is 6.29:1.
                          //
                          // Not green either, though green would also pass:
                          // this panel already spends green on "Twin only",
                          // "Ready to run" and the simulate button, all
                          // meaning "safe". This is the app's primary action,
                          // so it wears the app's primary colour.
                          '&.Mui-disabled': {
                            // The theme's disabled fill is grey[200] on a
                            // white page. On this dark scrim that rendered a
                            // near-white slab with #d9d9d9 text — 1.24:1, and
                            // brighter than anything around it.
                            bgcolor: panel.primaryTint(0.25),
                            color: panel.text,
                          },
                        }}
                      >
                        {confirmSending ? 'Sending…' : 'Confirm'}
                      </Button>
                    )}
                  </Box>
                )}

                {/* ── Slot 1: NOW — one pill, over the live view ──
                    Both messages that report on this instant share this one
                    place: the operator's eye is on the video during a run, and
                    an overlay cannot be scrolled away or push the video down
                    the way a flex-child banner did.

                    A "Show message" outranks the automatic step-completed ack:
                    the first is text a person wrote for this moment, the second
                    is the panel talking about itself. They can be a few hundred
                    milliseconds apart — a confirmed step followed straight into
                    a notify — and only one of them is worth the interruption.

                    Not a live region: the STATUS line below is the panel's
                    single announcer for run progress, and a second one here
                    would say the same thing twice (see its own comment). */}
                {/* Object wait: a bar, not a scrim. Pinned to the bottom
                    edge so the arm and the object stay visible above it, and
                    carrying the live detection so the operator can aim rather
                    than guess. `overlayChip` for the same reason as everything
                    else on this video — it must be readable over a near-white
                    Gazebo frame and over a real room. */}
                {isObjectStep && (
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{
                      position: 'absolute',
                      left: 8,
                      right: 8,
                      bottom: 8,
                      alignItems: 'center',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: panel.overlayChip,
                      border: `1px solid ${panel.primaryTint(0.5)}`,
                    }}
                  >
                    <ScanEye
                      size={16}
                      color={
                        activeDetections.length > 0
                          ? panel.successLight
                          : panel.primaryFaint
                      }
                      style={{ flexShrink: 0 }}
                    />
                    <Typography
                      sx={{
                        fontSize: panelType.small,
                        color: panel.text,
                        flex: 1,
                        minWidth: 0,
                      }}
                      noWrap
                    >
                      {humanStepLabel ?? 'Show the object to the camera'}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: panelType.small,
                        fontFamily: "'Geist Mono', monospace",
                        fontWeight: 600,
                        color:
                          activeDetections.length > 0
                            ? panel.successLight
                            : panel.textDim,
                        flexShrink: 0,
                      }}
                    >
                      {activeDetections.length > 0
                        ? activeDetections
                            .slice(0, 2)
                            .map((d) => d.class)
                            .join(', ')
                        : '—'}
                    </Typography>
                  </Stack>
                )}

                {videoPill && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 12,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      maxWidth: 'calc(100% - 24px)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.8,
                      padding: '6px 14px',
                      // Its own ground, not the video's. As a tint this
                      // measured 1.22:1 (success) and 1.59:1 (notify) over the
                      // Gazebo frame — the operator's own authored message,
                      // invisible. The tone moved into the border and the
                      // icon, which is where it can survive an opaque chip.
                      background: panel.overlayChip,
                      border: `1px solid ${
                        videoPill.tone === 'success'
                          ? panel.successTint(0.55)
                          : panel.primaryTint(0.55)
                      }`,
                      borderRadius: '20px',
                      '@media (prefers-reduced-motion: no-preference)': {
                        animation: 'dt-pill-in 0.2s ease',
                      },
                      '@keyframes dt-pill-in': {
                        from: {
                          opacity: 0,
                          transform: 'translate(-50%, -6px)',
                        },
                        to: { opacity: 1, transform: 'translate(-50%, 0)' },
                      },
                    }}
                  >
                    {videoPill.tone === 'success' ? (
                      <CheckCircle2
                        size={13}
                        color={panel.success}
                        style={{ flexShrink: 0 }}
                      />
                    ) : (
                      <Bell
                        size={13}
                        color={panel.primaryLight}
                        style={{ flexShrink: 0 }}
                      />
                    )}
                    <Typography
                      sx={{
                        fontSize: panelType.small,
                        color:
                          videoPill.tone === 'success'
                            ? panel.successLight
                            : panel.primaryFaint,
                        fontWeight: 500,
                      }}
                    >
                      {videoPill.text}
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
                          fontSize: panelType.micro,
                          color: panel.textDim,
                          letterSpacing: '0.07em',
                          textTransform: 'uppercase',
                          mb: 0.3,
                        }}
                      >
                        Required
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: panelType.display,
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
                      {/* The word names the gesture; the drawing is what
                          actually tells the operator what to do with their
                          hand. Under a countdown, in a second language, the
                          drawing is the faster of the two to read. */}
                      {RequiredGestureIcon && (
                        <RequiredGestureIcon
                          size={30}
                          color={
                            gestureMatch
                              ? panel.successLight
                              : panel.primaryFaint
                          }
                          style={{ marginTop: 4 }}
                        />
                      )}
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography
                        sx={{
                          fontSize: panelType.micro,
                          color: panel.textDim,
                          letterSpacing: '0.07em',
                          textTransform: 'uppercase',
                          mb: 0.3,
                        }}
                      >
                        Detected
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: panelType.display,
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
                      {DetectedGestureIcon && (
                        <DetectedGestureIcon
                          size={30}
                          color={
                            gestureMatch
                              ? panel.successLight
                              : gestureActive
                                ? panel.primaryLight
                                : panel.textDim
                          }
                          style={{ marginTop: 4 }}
                        />
                      )}
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
                  {/* Two colours, not three. Amber is taken: across this panel
                      it means "this reaches the physical arm" — the run button,
                      the live-hardware banner, the confirm dialog. Spending it
                      on "twenty seconds left" gave the same colour a second,
                      unrelated meaning on the same screen, for a state the
                      operator cannot act on differently. Indigo is the app's
                      neutral running colour and is what this is: time passing.
                      Red enters only in the last fifth, where "about to
                      expire" IS actionable. */}
                  <LinearProgress
                    variant="determinate"
                    value={countdownPct}
                    aria-hidden
                    sx={{
                      height: 6,
                      borderRadius: 3,
                      mb: 0.5,
                      backgroundColor: panel.trackBg,
                      '& .MuiLinearProgress-bar': {
                        backgroundColor: countdownIsCritical
                          ? panel.error
                          : panel.primary,
                        borderRadius: 2,
                        // Linear, and matched to the 100ms tick: MUI's default
                        // easing makes each tick accelerate then settle, which
                        // at ten ticks a second reads as jitter rather than as
                        // a bar draining evenly.
                        transition: 'transform 100ms linear',
                      },
                      '@media (prefers-reduced-motion: reduce)': {
                        '& .MuiLinearProgress-bar': { transition: 'none' },
                      },
                    }}
                  />
                  <Typography
                    sx={{
                      fontSize: panelType.display,
                      fontFamily: "'Geist Mono', monospace",
                      color: countdownIsCritical
                        ? panel.errorLight
                        : panel.muted,
                      textAlign: 'right',
                    }}
                  >
                    {countdown}s
                  </Typography>
                  {/* The bar and the number are silent to a screen reader —
                      announcing a value that changes ten times a second (or
                      even once a second) is unusable. This says something only
                      when it becomes worth saying. */}
                  <Box
                    component="span"
                    role="status"
                    aria-live="polite"
                    sx={{
                      position: 'absolute',
                      width: 1,
                      height: 1,
                      overflow: 'hidden',
                      clip: 'rect(0 0 0 0)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {countdownIsCritical ? 'Time is almost up' : ''}
                  </Box>
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
                <Typography
                  sx={{ fontSize: panelType.small, color: panel.textDim }}
                >
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
                    sx={{ fontSize: panelType.body, color: panel.textDim }}
                  >
                    Camera
                  </Typography>
                  <Typography
                    sx={{ fontSize: panelType.micro, color: panel.muted }}
                  >
                    {testCameraOn && webcam.active
                      ? 'Webcam on — detecting gestures'
                      : 'Try it out any time — see how gesture recognition works before running the task'}
                  </Typography>
                </Box>
                <Tooltip
                  title={
                    testCameraOn
                      ? 'Webcam on — gestures must really happen'
                      : 'Gesture conditions auto-completed'
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
                    sx={{ fontSize: panelType.body, color: panel.textDim }}
                  >
                    Object detection
                  </Typography>
                  <Typography
                    sx={{ fontSize: panelType.micro, color: panel.muted }}
                  >
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
                    sx={{ fontSize: panelType.body, color: panel.textDim }}
                  >
                    Voice
                  </Typography>
                  <Typography
                    sx={{ fontSize: panelType.micro, color: panel.muted }}
                  >
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
                      : 'Voice conditions auto-completed'
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
                    sx={{ fontSize: panelType.small, color: panel.textDim }}
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
                        sx={{ fontSize: panelType.small, color: panel.textDim }}
                      >
                        Starting camera…
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
                          fontSize: panelType.small,
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
                            background: panel.overlayChip,
                            border: `1px solid ${panel.primaryTint(0.6)}`,
                            borderRadius: '12px',
                          }}
                        >
                          <SandboxGestureIcon size={11} color={panel.white} />
                          <Typography
                            sx={{
                              fontSize: panelType.micro,
                              fontWeight: 600,
                              color: panel.white,
                              fontFamily: "'Geist Mono', monospace",
                            }}
                          >
                            {gestureLabel(webcam.gesture)}
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
                            background: panel.overlayChip,
                            border: `1px solid ${panel.successTint(0.6)}`,
                            borderRadius: '12px',
                          }}
                        >
                          <Eye size={11} color={panel.white} />
                          <Typography
                            sx={{
                              fontSize: panelType.micro,
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
                      left: 8,
                      maxWidth: 'calc(100% - 16px)',
                      overflow: 'hidden',
                      // 50%-white text with no ground at all measured exactly
                      // 1.00:1 on a bright frame — the same colour as what was
                      // behind it. This is the one element that was not merely
                      // low-contrast but literally invisible.
                      background: panel.overlayChip,
                      borderRadius: '6px',
                      padding: '3px 8px',
                    }}
                  >
                    <Typography
                      noWrap
                      sx={{
                        fontSize: panelType.micro,
                        color: panel.textDim,
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
                      fontSize: panelType.small,
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
                              fontSize: panelType.small,
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
                    fontSize: panelType.micro,
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
                  {RECOGNIZED_GESTURES.map((g) => {
                    const Icon = gestureIcon(g.code)
                    return (
                      <Stack
                        key={g.code}
                        direction="row"
                        spacing={0.6}
                        sx={{
                          alignItems: 'center',
                          padding: '4px 9px',
                          borderRadius: '12px',
                          border: `1px solid ${panel.hairlineStrong}`,
                          background: panel.chrome,
                        }}
                      >
                        {Icon && <Icon size={15} style={{ flexShrink: 0 }} />}
                        <Typography
                          sx={{
                            fontSize: panelType.small,
                            color: panel.textDim,
                          }}
                        >
                          {g.label}
                        </Typography>
                      </Stack>
                    )
                  })}
                </Stack>

                <Typography
                  sx={{
                    fontSize: panelType.micro,
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
                        sx={{ fontSize: panelType.small, color: panel.textDim }}
                      >
                        {v.label}
                      </Typography>
                    </Box>
                  ))}
                </Stack>

                <Typography
                  sx={{ fontSize: panelType.micro, color: panel.muted }}
                >
                  The robot's camera looks for objects here.
                </Typography>
              </Box>
            </Box>
          )}
        </Box>

        {/* ── RUN — only on the Robot tab; the Test recognition
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
                  fontSize: panelType.micro,
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
                {/* The panel's live region for run progress, and the only one
                    that announces the start of a human step — the overlay below
                    is purely visual, so without this a screen-reader user is
                    told the wait EXPIRED but never that it began.
                    Deliberately on this always-mounted element rather than on
                    the overlay: a live region inserted into the DOM already
                    populated is announced unreliably, while a persistent one
                    whose text changes is not. The message already names the
                    channel (see humanStepLabel above), which is the part the
                    operator needs. */}
                <Typography
                  role="status"
                  aria-live="polite"
                  sx={{
                    fontSize: panelType.body,
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

            {/* Pre-flight controls only. All of these are disabled once a run
              starts, and together they push EVENTS — whose gesture/voice
              readouts are the only live ones on screen — below the fold on a
              laptop viewport exactly while they are updating. STATUS stays,
              and the safety line that still applies mid-run (the teach-pendant
              e-stop) lives in the footer, which is always visible. */}
            {!simulation.isRunning && (
              <>
                <Stack
                  direction="row"
                  sx={{ alignItems: 'center', gap: 1, mb: 1 }}
                >
                  <Typography
                    sx={{ fontSize: panelType.body, color: panel.textDim }}
                  >
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
                        label: UI_TEXT.targetSimulation,
                        icon: <MonitorPlay size={13} />,
                        activeColor: panel.success,
                      },
                      {
                        value: 'real',
                        label: UI_TEXT.targetRobot,
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
                        sx={{ fontSize: panelType.body, color: panel.textDim }}
                      >
                        Answer human steps automatically
                      </Typography>
                      <Typography
                        sx={{ fontSize: panelType.micro, color: panel.muted }}
                      >
                        The simulation will not wait for a gesture, a voice
                        command or the Confirm button. Use it when no camera or
                        microphone is available.
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
                        '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track':
                          {
                            backgroundColor: panel.primary,
                          },
                      }}
                    />
                  </Stack>
                ) : executionTarget === 'sim' ? (
                  // Study mode on simulation: no toggle to offer, but the
                  // absence of one must not read as "the setting is missing".
                  <Box sx={{ mb: 1 }}>
                    <PanelMessage tone="info" dense>
                      Study mode — every operator step must be performed live.
                    </PanelMessage>
                  </Box>
                ) : (
                  <Box sx={{ mb: 1 }}>
                    <PanelMessage tone="hardware" dense>
                      Live hardware — the real robot will move. Gestures and
                      voice commands must be performed live.
                    </PanelMessage>
                  </Box>
                )}

                {/* Only what this task actually uses — never both by default —
                and said up front, since the browser's own permission prompt
                gives no context for why it's asking. */}
                {runMode === 'live' && needsCameraOrVoice && (
                  <Box sx={{ mb: 1 }}>
                    <PanelMessage
                      tone="info"
                      dense
                      icon={taskNeedsCamera ? Camera : Mic}
                    >
                      Run will ask for{' '}
                      {taskNeedsCamera && taskNeedsVoice
                        ? 'camera and microphone access'
                        : taskNeedsCamera
                          ? 'camera access'
                          : 'microphone access'}{' '}
                      — gestures/voice must really happen.
                    </PanelMessage>
                  </Box>
                )}

                {/* Both targets get an explicit, honest note — silence on the
                Simulation side would read as "probably fine" rather than the
                actual guarantee (the physical arm cannot move from this button,
                full stop). Progressive disclosure only for the extra hardware
                badge/select, which only matters once "Real robot" is chosen.

                Green, not amber, and that is the whole colour rule in one
                place: this notice sits directly under the "Live hardware"
                amber one on the other target, and if both were amber the
                reserved meaning ("the arm moves") would be carried by the
                sentence that promises the opposite. */}
                {executionTarget === 'sim' && (
                  <Box sx={{ mb: 1 }}>
                    <PanelMessage tone="success" dense icon={MonitorPlay}>
                      Twin only — the physical arm never moves from this button.
                    </PanelMessage>
                  </Box>
                )}
              </>
            )}
          </Box>
        )}

        {/* ── EVENTS — only while events can actually happen ── */}
        {eventsVisible && (
          <Box>
            <SectionLabel>Conditions</SectionLabel>
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
                  {/* The live gesture's own icon, not a generic hand: a
                      static `Hand` here reads as "Open hand" now that it is
                      that gesture's icon, so the channel label claimed a
                      specific value. Falls back to `Hand` only while nothing
                      is detected, where there is no value to misread. */}
                  <EventsGestureIcon
                    size={13}
                    color={gestureActive ? panel.primaryLight : panel.textDim}
                  />
                  <Typography
                    sx={{ fontSize: panelType.micro, color: panel.textDim }}
                  >
                    Gesture
                  </Typography>
                </Stack>
                <Typography
                  sx={{
                    fontSize: panelType.body,
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
                  <Typography
                    sx={{ fontSize: panelType.micro, color: panel.textDim }}
                  >
                    Objects
                  </Typography>
                </Stack>
                <Typography
                  sx={{
                    fontSize: panelType.body,
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
                    : NOTHING_RECOGNIZED}
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
                  <Typography
                    sx={{ fontSize: panelType.micro, color: panel.textDim }}
                  >
                    Voice
                  </Typography>
                </Stack>
                <Typography
                  sx={{
                    fontSize: panelType.body,
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
                        : voice.word
                          ? voiceLabel(voice.word)
                          : voice.active
                            ? 'Listening…'
                            : NOTHING_RECOGNIZED}
                </Typography>
              </Stack>
            </Stack>
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
            // `stopping` holds Run down until the server confirms the previous
            // run let go. Pressing it a second earlier used to return 409 and
            // surface as a red error, or — worse and silently — start a run
            // into a world the previous Stop was still tearing down.
            disabled={
              !simulation.isRunning &&
              (stopping ||
                !canRun ||
                (executionTarget === 'real' && !hardwareArmed))
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
              fontSize: panelType.body,
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
              : stopping
                ? 'Stopping…'
                : executionTarget === 'real'
                  ? UI_TEXT.runOnRobot
                  : UI_TEXT.startSimulation}
          </Button>
          {executionTarget === 'real' && (
            <Stack
              direction="row"
              spacing={0.6}
              sx={{ alignItems: 'center', justifyContent: 'center', mt: 1 }}
            >
              <AlertTriangle
                size={13}
                color={panel.warning}
                style={{ flexShrink: 0 }}
              />
              <Typography
                sx={{
                  fontSize: panelType.small,
                  fontWeight: 500,
                  color: panel.warningLight,
                  textAlign: 'center',
                }}
              >
                Use the teach-pendant e-stop to stop the arm immediately.
              </Typography>
            </Stack>
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
                    {/* Amber only when the arm is the problem. The other
                        pre-flight issues — a draft task, auto-answered human
                        steps, a browser without speech — are things to know,
                        not things the arm is doing, and they used to sit here
                        in the same amber as the hardware ones. What makes them
                        read as blockers is where they are (directly under a
                        disabled Run) and that they carry a fix, not the
                        colour. */}
                    {issue.tone === 'hardware' ? (
                      <AlertTriangle
                        size={12}
                        color={panel.warning}
                        style={{ flexShrink: 0 }}
                      />
                    ) : (
                      <Info
                        size={12}
                        color={panel.primaryLight}
                        style={{ flexShrink: 0 }}
                      />
                    )}
                    <Typography
                      sx={{
                        fontSize: panelType.small,
                        color:
                          issue.tone === 'hardware'
                            ? panel.warningLight
                            : panel.textDim,
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
                          fontSize: panelType.small,
                          minHeight: 32,
                          py: 0.4,
                          px: 1,
                          textTransform: 'none',
                          fontWeight: 600,
                          color: panel.primaryFaint,
                          border: `1px solid ${panel.primaryTint(0.35)}`,
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
                  sx={{ fontSize: panelType.small, color: panel.successLight }}
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
        // Amber, not terracotta: starting the arm is consequential, not
        // destructive, and red is the Stop button once it is running.
        tone="caution"
        confirmOnEnter={false}
        onConfirm={confirmAndRun}
        onCancel={() => setConfirmRealRun(false)}
      />
    </Box>
  )
}
