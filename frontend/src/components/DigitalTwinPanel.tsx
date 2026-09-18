import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Typography,
  Collapse,
  Stack,
  CircularProgress,
  IconButton,
  Button,
  Switch,
  TextField,
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
  ChevronRight,
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
  Info,
  ScanEye,
  Clock,
  User,
  Bot,
} from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'
import * as Blockly from 'blockly/core'
import { useTheme } from '@mui/material/styles'
import useSWR from 'swr'

import { TaskStatus } from 'pages/tasks/types'
import { useAppSelector } from 'store/reducers'
import {
  toggleSim,
  setRobotPanelWidth,
  ROBOT_PANEL_MIN_PX,
  ROBOT_PANEL_DEFAULT_PX,
} from 'store/reducers/task'
import {
  RECOGNIZED_GESTURES,
  RECOGNIZED_VOICE_COMMANDS,
  voiceLabelWithSpokenForm,
  voiceLabelWithSpokenFormByCode,
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
import { useRecognitionSound } from 'hooks/useRecognitionSound'
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
/**
 * The workspace never goes below this, whatever the other two panels ask for.
 *
 * It is the app's primary surface — the place the task is actually built — and
 * it was the only one of the three with no minimum: Copilot has flexShrink 0
 * and this panel is fixed, so the workspace absorbed every request until it was
 * a 31px stripe of half-drawn blocks. 480px is a human-action block with its
 * resume condition still readable, which is the widest thing a task normally
 * holds.
 */
const WORKSPACE_MIN_PX = 480
/** Nav rail + the row's own padding and gutters. */
const LAYOUT_CHROME_PX = 104

/**
 * The video's own ceiling, and therefore the panel's.
 *
 * The live view is capped at 64vh of width (see the box below for why that
 * number). Past the width where the video stops growing, a wider panel buys
 * nothing: the stream — the reason the panel is open — stays exactly the same
 * size while the workspace shrinks to pay for it. So the panel may not grow
 * beyond its own content's ceiling plus the 16px padding on each side.
 *
 * Expressed in vh for the same reason the video's cap is: what bounds this is
 * the vertical budget, and a 4:3 box spends 0.75px of height per px of width.
 */
const PANEL_MAX_CSS = 'calc(64vh + 32px)'

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

/** Height of the live-view box while nothing is running. Enough to read the
 *  placeholder and to keep the panel's shape, not enough to own the fold. */
const IDLE_VIDEO_STRIP_PX = 96

// Wait budget for a human step, in seconds. The default matches the backend's
// own CONDITION_TIMEOUT_S; the bounds match MIN/MAX_HUMAN_TIMEOUT_S there.
// The floor is not cosmetic — a budget of a second or two expires before this
// panel has finished drawing what it is asking for, so every step would fail
// in a way that reads as the operator's fault.
const HUMAN_TIMEOUT_KEY = 'humanStepTimeoutSeconds'
const DEFAULT_HUMAN_TIMEOUT_S = 30
const MIN_HUMAN_TIMEOUT_S = 5
const MAX_HUMAN_TIMEOUT_S = 300
const clampHumanTimeout = (n: number) =>
  Math.round(Math.min(MAX_HUMAN_TIMEOUT_S, Math.max(MIN_HUMAN_TIMEOUT_S, n)))

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
  // The completion TEXT, not a boolean: a step can complete with something
  // worth naming (a simulated detection says what it found and that it was
  // simulated) or with nothing to add, where the generic line is right
  // because the operator has just done the thing themselves.
  const [stepCompleted, setStepCompleted] = useState<string | null>(null)
  // Milliseconds left, not whole seconds: the bar reads this directly, so it
  // moves ten times a second instead of stepping 3.3% once a second. The
  // number on screen still shows whole seconds.
  const [remainingMs, setRemainingMs] = useState<number | null>(null)

  // How long a human step may wait, in seconds, for runs started from this
  // panel. Kept here rather than on the block: a field on Pause and show would
  // be more expressive, but it changes the Blockly schema and therefore the
  // prompt and validator in chat.py, which invalidates an evaluation campaign
  // measured against a frozen chat.py.
  //
  // Persisted like the sound preference: this is a property of the bench the
  // operator is working at — how long they need to reach the rack and back —
  // not of the task, and re-entering it on every visit is the kind of friction
  // that makes a setting go unused.
  //
  // Bounds are duplicated on the server (MIN/MAX_HUMAN_TIMEOUT_S in
  // simulate.py) because a request body is a trust boundary whatever this
  // input does.
  const [humanTimeout, setHumanTimeout] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_HUMAN_TIMEOUT_S
    const stored = Number(localStorage.getItem(HUMAN_TIMEOUT_KEY))
    return Number.isFinite(stored) && stored > 0
      ? clampHumanTimeout(stored)
      : DEFAULT_HUMAN_TIMEOUT_S
  })
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
  // Announced to assistive tech only. The width that actually applies is the
  // CSS `min()` on the panel below, which re-evaluates on every window resize
  // without anything having to re-render; this mirrors it for aria-valuemax so
  // a keyboard user is told the same ceiling they will hit.
  const maxPanelPx =
    typeof window !== 'undefined'
      ? Math.max(
          ROBOT_PANEL_MIN_PX,
          Math.min(
            // PANEL_MAX_CSS, in the units this side of the stylesheet has.
            window.innerHeight * 0.64 + 32,
            window.innerWidth -
              LAYOUT_CHROME_PX -
              WORKSPACE_MIN_PX -
              (parseFloat(
                getComputedStyle(document.documentElement).getPropertyValue(
                  '--copilot-width',
                ),
              ) || 0),
          ),
        )
      : ROBOT_PANEL_DEFAULT_PX
  // The width travels as a CSS custom property, and React is told once, at the
  // end.
  //
  // Three attempts got here. Dispatching on every pointermove meant a store
  // update, a re-render of everything subscribed to it and a
  // localStorage.setItem sixty times a second. Moving to local React state
  // fixed the weight but broke the layout: the row reserves its room from the
  // Redux value, so the workspace only caught up when the mouse was released.
  //
  // A custom property fixes both, because it is the one channel BOTH sides
  // already read — this panel's own `width` and the row's `paddingRight`. A
  // drag frame writes one string to documentElement.style: no reconciliation,
  // no store, and every dependent box moves in the same frame. Redux is told on
  // release, where it is a preference to persist rather than a live value.
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    if (isResizing) return
    document.documentElement.style.setProperty(
      '--robot-panel-width',
      `${robotPanelWidth}px`,
    )
  }, [robotPanelWidth, isResizing])

  const startPanelResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = robotPanelWidth
    let latest = startWidth
    setIsResizing(true)
    // Flags the drag on the document element so CSS elsewhere can suspend its
    // own transitions — the row's padding-right in task-workspace is the one
    // that matters, because it is what synthesises the gap beside this panel.
    // A DOM attribute rather than Redux: it is read by a stylesheet, not by a
    // component, and it must land in the same frame as the width.
    document.documentElement.dataset.panelResizing = ''
    const onMove = (ev: PointerEvent) => {
      // Dragging LEFT widens: the panel is anchored to the right edge.
      latest = Math.max(ROBOT_PANEL_MIN_PX, startWidth + (startX - ev.clientX))
      document.documentElement.style.setProperty(
        '--robot-panel-width',
        `${latest}px`,
      )
    }
    // pointercancel, not just pointerup. Under touch the system can take the
    // pointer away mid-gesture — an incoming call, a system gesture, a finger
    // leaving the screen — and pointerup never fires. Without this listener the
    // two handlers stay attached and data-panel-resizing stays on the document,
    // which keeps the neighbouring row's transitions suspended for the rest of
    // the session. Same shape the toolbox drag already uses (BlocklyEditor).
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      setIsResizing(false)
      delete document.documentElement.dataset.panelResizing
      dispatch(setRobotPanelWidth(latest))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }
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
  const sound = useRecognitionSound()

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
    setStepCompleted(humanStep.description || 'Step completed')
    const t = setTimeout(() => setStepCompleted(null), MESSAGE_TTL_MS)
    return () => clearTimeout(t)
  }, [humanStep])

  // "Show message" — authored text, shown over the live view (slot 1), because
  // that is where the operator is looking during a run. It used to be a banner
  // at the top of the scroll body: a plain flex child with no sticky and no
  // scroll-into-view, so it could appear off-screen and delete itself four
  // seconds later, and mounting it shoved the whole video down ~44px mid-run.
  // It lasts until something makes it stale, and it used to last four seconds.
  //
  // MESSAGE_TTL_MS is the lifetime the panel's duration rule gives to "an
  // event with nothing left to handle" — a step completing, a run finishing.
  // This is the other case in that same rule, and it always was: the entire
  // reason the block exists is that a PERSON has to read something, and
  // "and continue" means the program will not wait while they do. So the thing
  // left to handle is the reading, and nothing on screen could know it had
  // happened. Four seconds is about what it takes to notice a pill has
  // appeared, look up from a moving arm, and find it already gone.
  //
  // Three things end it now, and each one is a real reason the text stopped
  // being what the operator needs to see:
  //
  //   1. they dismiss it — the only positive evidence it was read;
  //   2. a newer authored message takes the slot. Another Show message
  //      overwrites this state; a waiting human step clears it (below), and
  //      that one also outranks it in `videoPill` so the two can never fight
  //      over the same 40 pixels of video;
  //   3. the run ends (below). A message about a run that is over is not a
  //      message, and leaving it there would carry it into the next run.
  //
  // Deliberately NOT a longer timeout. Any number picked here is a guess about
  // how long someone needs to walk to a bench and back, and the failure it
  // produces is silent: the instruction disappears while they are away from
  // the screen, which is the case the block exists for.
  useEffect(() => {
    if (humanStep?.status !== 'notify') return
    setNotifyPill(humanStep.description || 'Notification')
  }, [humanStep])

  // A waiting step supersedes a Show message: the operator's attention has a
  // new destination, and the older text is no longer the one to act on. Not
  // queued behind it either — `videoPill`'s priority would otherwise bring the
  // stale pill back the moment the wait resolved.
  useEffect(() => {
    if (humanStep?.status === 'started') setNotifyPill(null)
  }, [humanStep])

  // And it does not outlive its run. Without this the pill would still be over
  // the video when the panel is opened for the next task, describing a step of
  // one that finished — the same leak the per-visit Redux flags in
  // store/reducers/task.ts have to be re-synced for.
  useEffect(() => {
    if (!simulation.isRunning) setNotifyPill(null)
  }, [simulation.isRunning])

  // The audible half of the same three moments the pills announce visually.
  //
  // Keyed on `humanStep`, the one object that already carries every transition
  // of an operator step, so the sound cannot drift out of step with what the
  // panel is showing — they are driven from the same event.
  //
  // The microphone is open across the WHOLE run, not just during a voice step
  // (`voiceActive` is `simulation.isRunning && taskNeedsVoice`), so these tones
  // are always heard by the recogniser. They cannot be misread as a command:
  // matchVoiceKeyword accepts only the four exact words, and a sine burst is
  // not one of them.
  useEffect(() => {
    if (!humanStep) return
    if (humanStep.status === 'started') sound.play('waiting')
    else if (humanStep.status === 'completed') sound.play('accepted')
    else if (humanStep.status === 'timeout' || humanStep.status === 'error') {
      sound.play('failed')
    }
    // `sound` is deliberately not a dependency: `play` changes identity with
    // the mute setting, and re-running this effect on a toggle would replay
    // the cue of whatever step happens to be current.
    // eslint-disable-next-line @eslint-react/exhaustive-deps
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
          // Omitted during a study session, not merely greyed out.
          //
          // The field is locked there, but a locked field still HAS a value,
          // and sending it made the panel's 30 silently override the
          // HUMAN_STEP_TIMEOUT_S the protocol set on the server. The session
          // would have run to a budget nobody chose, with the lock on screen
          // suggesting the opposite. Absent means "the server decides", which
          // is what a locked control should mean.
          ...(STUDY_MODE ? {} : { humanStepTimeout: humanTimeout }),
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
    // Web Audio has to be started from a user gesture or it stays suspended
    // and every later cue is dropped silently. This click is that gesture.
    sound.unlock()
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
  // Collapsed only when nothing is happening. `isHumanStepActive` is listed
  // separately from `isRunning` on purpose: a wait is the state where the
  // operator most needs the view, and it is also the state where the run flag
  // could plausibly be reworked later.
  const videoCollapsed = !simulation.isRunning && !isHumanStepActive

  const [runSettingsOpen, setRunSettingsOpen] = useState(false)
  // The summary is the point of collapsing: it answers "what will happen" at a
  // glance, so opening the section is for CHANGING a setting, never for
  // checking one.
  // Describes exactly what is INSIDE the disclosure, nothing else. The
  // auto-answer switch stayed in the open — it shares a branch with the
  // "the real robot will move" notice, and that notice must not be
  // collapsible — so naming it here would describe a control the row does
  // not contain.
  const runSettingsSummary = [
    sound.enabled ? 'Sound on' : 'Sound off',
    STUDY_MODE ? null : `waits ${humanTimeout}s`,
  ]
    .filter(Boolean)
    .join(' · ')
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
  // All FOUR channels reach it now. It used to serve only the overlay, which
  // gesture and object steps are excluded from so the camera stays visible —
  // and that exclusion silently took the operator's own instruction with it
  // (see videoPill). The instruction moved onto the video, so this mark rides
  // along and has to answer for every channel.
  //
  // Mic and Clock are the marks this panel and the chat preview already use
  // for voice and time. A gesture step draws THE GESTURE it is asking for, the
  // same rule the REQUIRED readout follows — `Hand` only as the fallback,
  // where there is no named gesture to misread. `ScanEye` is the Conditions
  // category's own mark for "an object is detected". `User` is the "Pause and
  // show message" block's icon in the toolbox, which ties the runtime moment
  // back to the block on the canvas.
  const WaitIcon =
    humanStep?.condition === 'voice'
      ? Mic
      : humanStep?.condition === 'timer'
        ? Clock
        : humanStep?.condition === 'gesture'
          ? gestureIcon(humanStep?.value) || Hand
          : humanStep?.condition === 'object'
            ? ScanEye
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

  // What the step wants, next to what the system currently perceives — for
  // EVERY channel that perceives something, not only for gesture.
  //
  // It existed for gesture alone, and the gap it left is the one an operator
  // cannot reason their way out of: without it, "the microphone is not hearing
  // me" and "the microphone hears me and the word is wrong" look identical,
  // and so do "the camera cannot see the tube" and "the camera sees it as
  // something else". That is the difference between trying again and changing
  // what you are doing, and the operator has about thirty seconds to pick.
  //
  // It matters twice over for Part B, which times the four channels against
  // each other: a channel that shows whether it is perceiving you is not
  // competing on equal terms with three that do not.
  //
  // human_feedback and timer return null on purpose. A button press is not a
  // perception — the button is its own readout — and a timer perceives nothing.
  const waitReadout: {
    required: string
    detected: string
    match: boolean
  } | null = useMemo(() => {
    if (!isHumanStepActive || !humanStep) return null
    switch (humanStep.condition) {
      case 'gesture':
        return {
          required: gestureLabel(humanStep.value),
          detected: gestureLabel(activeGesture),
          match: gestureMatch,
        }
      case 'voice': {
        const heard = voice.word
        return {
          // REQUIRED carries the word to SAY, not the command's name. Under a
          // countdown, "Proceed" is not actionable when the recogniser is
          // listening in Italian; 'Proceed ("procedi")' is. DETECTED stays the
          // plain label — it reports what was heard, and the operator does not
          // have to pronounce it again.
          required: voiceLabelWithSpokenFormByCode(humanStep.value),
          detected: heard ? voiceLabel(heard) : '—',
          match: !!heard && heard === humanStep.value,
        }
      }
      case 'object': {
        const seen = activeDetections.map((d) => d.class)
        const want = String(humanStep.value ?? '')
        return {
          required: want,
          // Two names at most: the readout is scanned under a countdown, and a
          // full list of everything the model fired on is not scannable.
          detected: seen.length ? seen.slice(0, 2).join(', ') : '—',
          match: seen.some((c) => c.toLowerCase() === want.toLowerCase()),
        }
      }
      default:
        return null
    }
  }, [
    isHumanStepActive,
    humanStep,
    activeGesture,
    gestureMatch,
    voice.word,
    activeDetections,
  ])

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
      // A bypass is not a timeout, and the two arrive with the same status.
      //
      // simulate.py auto-satisfies a condition nothing can observe — no
      // detector running, an unreachable bridge — and reports it down this
      // same channel. The step PASSES and the run carries on, while this
      // banner said "object "tube" not detected", which is both the opposite
      // of what happened and an accusation aimed at the operator. Saying who
      // completed the step is the whole point: the log records these
      // separately for exactly the same reason (see _mark_condition_bypass).
      isTimeout &&
        humanStep?.bypass_reason && {
          key: 'bypass',
          tone: 'info' as const,
          text:
            humanStep.bypass_reason === 'vision_node_absent'
              ? 'Step completed by the system — no object camera is running, so nothing could look for it.'
              : humanStep.bypass_reason === 'bridge_unreachable'
                ? 'Step completed by the system — the camera could not be reached, so nothing could check.'
                : humanStep.bypass_reason === 'object_already_in_frame'
                  ? `Step completed by the system — "${humanStep.value}" was already in view before the step began.`
                  : 'Step completed by the system, not by you.',
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
  // `wait: true` marks the one entry that must not expire and that carries the
  // channel's own mark instead of the notify bell.
  const videoPill: {
    tone: 'info' | 'success'
    text: string
    wait?: boolean
    /** Present only on a message that persists until acknowledged. */
    onDismiss?: () => void
  } | null =
    [
      // The operator's own instruction, and it outranks everything because it
      // is the only text here they wrote themselves.
      //
      // It used to render in one place only — the dark overlay that replaces
      // the video — and gesture and object steps are deliberately excluded
      // from that overlay so the camera stays visible. Correct reason, unclosed
      // consequence: for those two channels the instruction was rendered
      // NOWHERE. "Show the camera a blue tube" ran with the screen saying only
      // "Waiting to find tube".
      //
      // That is a measurement problem, not only a usability one.
      // seed_partb_tasks.py gives all four Part-B tasks a single shared
      // _TASK_DESC precisely so the on-screen instruction is identical across
      // the four conditions — "anything else that differed between them would
      // be a second explanation for any difference in the measurements". The
      // constant made the DATA identical while two of the four screens showed
      // no instruction at all.
      //
      // So the instruction lives over the video, where Show message already
      // puts its own text. The camera stays visible for every channel, and the
      // difference between the two blocks stops being WHERE the message
      // appears and becomes how long it stays and what accompanies it.
      isHumanStepActive &&
        humanStep?.description && {
          tone: 'info' as const,
          text: humanStep.description,
          wait: true,
        },
      // The ✕ is what lets this one stay. A message that never expires and
      // cannot be closed is not persistent, it is stuck — and it sits on the
      // live view, the one thing the operator is watching.
      notifyPill && {
        tone: 'info' as const,
        text: notifyPill,
        onDismiss: () => setNotifyPill(null),
      },
      stepCompleted && { tone: 'success' as const, text: stepCompleted },
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
  // Hidden while a step is actually waiting, and that is the point rather than
  // a space saving. This section lists the recognisers generically — a
  // "Gesture" row is drawn whether or not the step is asking for a gesture —
  // so during an OBJECT wait the panel showed "Gesture … None" next to a step
  // that has nothing to do with gestures, and next to a STATUS line naming a
  // third thing. Three answers to "what is the robot waiting for", one of them
  // wrong.
  //
  // While a step waits, `waitReadout` above answers that question exactly, for
  // the channel actually in play. This comes back the moment the step resolves,
  // where it does its real job: showing that the recognisers are alive between
  // steps.
  const eventsVisible =
    (cameraActive || voiceActive || simulation.isRunning) && !isHumanStepActive

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

  // The event channel, checked FIRST, because without it this panel is blind
  // for the whole run.
  //
  // `connected` is the SocketIO stream on :5001 — block_step, human_step,
  // gestures, detections. It is not the arm and not the HTTP bridge: a run can
  // start over :5000 while this is down, and then the operator watches a still
  // picture with no highlighted block, no "waiting for a gesture", and no
  // countdown, which looks exactly like a run frozen at step zero.
  //
  // It was missing from this list, and that produced the contradiction an
  // operator reported: an amber "Offline" pill in the header above a green
  // "Ready to run" at the foot of the same column. Both were true — the pill is
  // about the channel, the checkmark about the task — but nothing said so, and
  // the reassuring one was the one next to the button. Listing it here makes
  // them agree by construction: "Ready to run" is the empty state of this list,
  // so it can no longer appear while the panel cannot see the run.
  if (!connected) {
    preflightIssues.push({
      // Not "from the simulator". The stream is the same on both targets, but
      // an operator who has just chosen "Real robot" reads that phrase as
      // naming the other mode and skips a notice that applies to them. Naming
      // what the panel cannot do is true either way, and it is the part they
      // can act on.
      text: 'No live updates — the run would start, but this panel could not show which block is running or when it needs you.',
    })
  }

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
        right: 'var(--layout-gutter)',
        top: 'calc(var(--layout-appbar-height, 56px) + var(--layout-gutter))',
        // The task-code panel is a flex sibling of the status bar; this one is
        // fixed, so nothing links it to either. Without the third term it sat
        // on top of the code panel whenever both were open — the operator
        // dragged the code view taller and watched the robot panel cover it.
        // --layout-codepanel-height is published by BottomPanel (and already
        // carries its own clamp), the same channel Copilot uses for its width.
        bottom: `calc(var(--layout-statusbar-height, 40px) + var(--layout-gutter) + var(--layout-codepanel-height, 0px))`,
        // Clamped so the workspace keeps a floor.
        //
        // Copilot is a flex sibling with flexShrink 0, this panel is fixed, and
        // the workspace between them is `flex: 1, minWidth: 0` — the only one
        // that yields, and it yields all the way to nothing. With Copilot
        // dragged to 600px and this panel at 50vw, a 1470px viewport left the
        // workspace 31px: a vertical stripe of half-drawn blocks, which reads
        // as broken rather than as narrow.
        //
        // So the chosen width is a request, not a promise. The panel takes what
        // it asked for or what is left over WORKSPACE_MIN_PX, whichever is
        // smaller. Pressing "wide" with Copilot open still widens the panel,
        // just not to 50vw — a control that does less is honest; one that
        // silently destroys the main surface is not.
        //
        // --copilot-width is published by ChatThread, the same trick the app
        // already uses for --layout-appbar-height above.
        width: `min(var(--robot-panel-width, 520px), ${PANEL_MAX_CSS}, calc(100vw - ${
          LAYOUT_CHROME_PX + WORKSPACE_MIN_PX
        }px - var(--copilot-width, 0px)))`,
        zIndex: 100,
        background: panel.surface,
        borderRadius: '16px',
        border: `1px solid ${panel.hairlineStrong}`,
        // No drop shadow and no backdrop blur. Both said "floating above the
        // page", and that stopped being true once the workspace started
        // reserving room for this panel: it is a column beside its peers now,
        // and it was the only one of the three wearing an elevation. Nothing
        // shows through it either, so the blur was cost without effect.
        // +12px so the panel clears the viewport entirely when closed.
        //
        // It is inset from the right edge by that much, so sliding it out by
        // 100% of its OWN width still left 12px of dark surface parked against
        // the edge. It looked like a collapsed drawer and behaved like nothing:
        // clicking it did not open the panel, because it is the panel — off
        // screen except for its inset — and the only thing that opens it is
        // Run. A strip that suggests an affordance it does not have is worse
        // than no strip.
        transform: simOpen
          ? 'translateX(0)'
          : 'translateX(calc(100% + var(--layout-gutter)))',
        // No width animation while the pointer is down. Copilot's handle has
        // always done this; without it every pointermove started a fresh 250ms
        // tween, so the panel chased the cursor a quarter second behind and the
        // drag felt broken rather than slow.
        transition: isResizing
          ? 'none'
          : 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        overflow: 'hidden',
        color: panel.text,
        outline: 'none',
      }}
    >
      {/* Resize handle, on the left edge because the panel is anchored right.
          Same WAI-ARIA "Window Splitter" pattern Copilot uses — role
          separator, focusable, arrow keys — because these two are peers and
          were being resized in two different ways: one dragged freely, the
          other snapped between two fixed widths by an icon. */}
      {simOpen && (
        /* eslint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */
        <div
          onPointerDown={startPanelResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize robot panel"
          aria-valuenow={robotPanelWidth}
          aria-valuemin={ROBOT_PANEL_MIN_PX}
          aria-valuemax={Math.round(maxPanelPx)}
          tabIndex={0}
          onKeyDown={(e) => {
            const STEP = 16
            // Left widens: the panel grows towards the workspace.
            const delta =
              e.key === 'ArrowLeft'
                ? STEP
                : e.key === 'ArrowRight'
                  ? -STEP
                  : null
            if (delta === null) return
            e.preventDefault()
            dispatch(setRobotPanelWidth(robotPanelWidth + delta))
          }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '6px',
            height: '100%',
            cursor: 'col-resize',
            // Without this the browser claims the gesture for page scrolling
            // and the drag never reaches the handler on a touch screen.
            touchAction: 'none',
            zIndex: 101,
            background: 'transparent',
          }}
          className="resize-handle"
        />
        /* eslint-enable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */
      )}

      {/* ── Header ── */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          // 16px, matching the footer and the scroll body below it. It was
          // 18px, so the title sat two pixels further in than every heading
          // under it and the panel had no single left edge.
          padding: '14px 16px',
          background: panel.chrome,
          borderBottom: `1px solid ${panel.hairline}`,
          flexShrink: 0,
        }}
      >
        <Stack direction="row" sx={{ alignItems: 'center' }} spacing={1.5}>
          {/* The panel is the robot, not the camera. This was a Camera icon —
              the same glyph used a few hundred pixels below as the video's own
              empty-state mark, so one symbol stood for two different things on
              one screen, and the more specific meaning (a video feed) was the
              one sitting on the title. `Bot` is also what the navigation rail
              already puts beside "My Robot": same object, same mark. */}
          <Bot size={16} color={panel.primary} />
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
          {/* One indicator, one shape, one hue per state.
              ── shape ──
              The pill used to appear only in the bad state while the good one
              was bare text, so the two halves of a single two-state control
              were built out of different components: a border and a fill
              arrived from nowhere, and the title beside it shifted sideways
              every time the stream dropped or came back.

              ── hue ──
              Then the two states still did not agree, because one was
              monochrome and the other was not: neutral pill, grey text, green
              dot — three families in the "on" state against amber-everything
              in the "off" one. Here each state takes exactly one tone and
              applies it to fill, border, dot and text alike, at the same 0.12 /
              0.4 intensities as the hardware chip below. Three chips, one
              component, hue is the only variable.

              ── why not amber, which is what "off" used to be ──
              Amber is reserved across this panel for one meaning — the
              physical arm is involved — and PanelMessage enforces it in the
              type system. `connected` is the SocketIO event stream: not the
              arm, not the HTTP bridge. The preflight list twenty lines up
              already reports this exact fact, and reports it as `info`,
              because that is what it is. The header said the same thing in
              amber, so one fact wore two colours in one column, and the amber
              one competed with the "Real robot" chip beside it — which is the
              only thing in this header that IS about the arm. Guarded by
              test_panel_chrome.py. */}
          {/* The connection indicator used to live here and no longer does.
              It said the same thing in three places at once: this pill, the
              "· events offline" annotation on the STATUS card, and the
              pre-flight row in the footer — which is outside the scroll region,
              so it is the copy the operator always sees, and it is the only one
              that says what BREAKS ("this panel could not show which block is
              running or when it needs you") rather than naming a transport.

              Keeping it here also cost the header's last free width, which the
              execution target now needs, and it invited the misreading a novice
              actually makes: "Live updates on" read as "the robot is connected". */}
          {/* The panel reserves amber for one meaning — the physical arm is
              involved — and enforces it in the type system. Then it put every
              amber cue inside the `!simulation.isRunning` gate, so all of them
              unmounted at the exact moment the arm started moving. The one
              period the meaning applies was the one period it was not on
              screen; what survived was a 10.5px grey caption.

              This chip lives in the header, outside every gate, and intensifies
              rather than disappears once the run starts. */}
          {/* THE TARGET LIVES HERE, and it is a control rather than a badge.
              Reported by users as "it is not obvious how to move from the twin
              to the physical robot", and the code explains why: setExecutionTarget
              has exactly ONE call site in the whole application, and it used to
              be a row inside the Run section, behind a ~370px video. Measured on
              a 900px viewport it ended at ~573px — below the fold — and widening
              the panel pushed it FURTHER down, because the 4:3 video grows 0.75px
              of height per px of width. The gesture meaning "show me more" hid
              the control they were hunting for.

              Nowhere else could be found instead: the task list deliberately
              sends 'sim' (a one-click action must not move a physical arm), and
              this header previously rendered a chip only when the target was
              ALREADY 'real', so a novice could not even learn that a second mode
              existed. The search always failed.

              The header never scrolls, so this is the one place the choice is
              reachable at every viewport and every panel width.

              Amber still means exactly one thing and still intensifies once the
              run starts — the reason the old chip lived outside every gate. What
              changes is that it now also answers "how do I get there". */}
          <SegmentedControl
            dark
            size="small"
            aria-label="Execution target"
            value={executionTarget}
            exclusive
            // Locked mid-run, not hidden: switching target while the arm is
            // moving is meaningless, but the operator must still see which one
            // is live. This is the state the old chip existed to cover.
            disabled={simulation.isRunning}
            onChange={(_, v) => v && setExecutionTarget(v)}
            options={[
              {
                value: 'sim',
                label: UI_TEXT.targetSimulation,
                icon: <MonitorPlay size={12} />,
                activeColor: panel.success,
              },
              {
                value: 'real',
                label: simulation.isRunning
                  ? UI_TEXT.targetRobotLive
                  : UI_TEXT.targetRobot,
                icon: <Cpu size={12} />,
                activeColor: panel.warning,
              },
            ]}
            sx={{ flexShrink: 1, minWidth: 0 }}
          />
        </Stack>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          {/* No expand/restore button. The panel had two ways to be
              resized — this icon and the edge handle — which is one more than
              Copilot beside it has and one more than anything needs. The
              handle is the shared model; a second control that jumps to fixed
              sizes competes with it and re-opens the inconsistency the handle
              was added to close. */}
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
          // The bottom step is breathing room above the footer's border, and
          // nothing more. An earlier comment here claimed it was clearance for
          // a pinned button overlapping the scroll — that was wrong: the
          // run/stop footer is a flex SIBLING with flexShrink 0, so this box
          // ends above it and nothing ever comes to rest underneath.
          //
          // What was actually reported as "cut off" was content below the
          // scroll fold, which is a scroll region working. The fix for that is
          // upstream — cap the video, and clip the Run section while a step is
          // waiting, both done — not padding down here.
          // Top / right / bottom / LEFT — and the right is 10, not 16, on
          // purpose. This is the panel's only scroll region and it had no
          // scrollbar styling at all, so it took the platform's, which is
          // about 15px wide and takes that width out of the CONTENT box. The
          // header and the footer are not scroll containers and lose nothing,
          // so every heading, card and the video sat 16px from the left edge
          // and ~31px from the right, under a Run button that spanned the full
          // 16/16. Reported as the panel not being centred, which is exactly
          // what it was.
          //
          // 10 + a 6px scrollbar is 16, so the content's right inset matches
          // its left one and both match the footer. `scrollbar-gutter: stable`
          // reserves that 6px whether or not the content currently overflows,
          // so nothing shifts sideways as the panel fills up.
          //
          // 6px, styled, is also what every other scroll surface in the app
          // already uses (Copilot, the toolbox, the task-code panel). This was
          // the only one left on the platform default.
          padding: '14px 10px 20px 16px',
          overflowY: 'auto',
          // Stops the gesture reaching the document when this body is already at
          // its end, or has nothing to scroll at all — which is most of the
          // time now that the idle panel fits.
          overscrollBehavior: 'contain',
          scrollbarGutter: 'stable',
          '&::-webkit-scrollbar': { width: '6px' },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
          '&::-webkit-scrollbar-thumb': {
            background: panel.trackBg,
            borderRadius: '4px',
          },
          '&::-webkit-scrollbar-thumb:hover': {
            background: panel.selectBorder,
          },
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
                  // 4:3 while there is something to see; a thin strip when
                  // there is not.
                  //
                  // Idle, this box renders ~370px of black saying "Start a
                  // simulation to see the robot here" — the largest and topmost
                  // element on the panel, carrying no information, at exactly
                  // the moment the operator is scanning for an action. Measured
                  // at the default 520px panel it takes 42% of the first
                  // viewport at 1080p, 53% at 900p, 62% at 800p.
                  //
                  // It collapses on IDLE only, never during a run or a wait.
                  // In simulation the video IS the robot — there is nowhere
                  // else to look — so shrinking it while anything is happening
                  // would remove the operator's only view. Idle is the one
                  // state where both targets have nothing to show.
                  aspectRatio: videoCollapsed ? undefined : '4/3',
                  height: videoCollapsed ? IDLE_VIDEO_STRIP_PX : undefined,
                  transition: 'height 0.22s cubic-bezier(0.25, 1, 0.5, 1)',
                  // Capped on WIDTH, and it has to be the width.
                  //
                  // Why a cap at all: expanding switches the panel from 35vw to
                  // 50vw, and an aspect-locked box answers more width with more
                  // HEIGHT. The control labelled "make this bigger" grew the
                  // video by about a third and pushed the wait state, the
                  // countdown and STATUS into the scroll region — "if I enlarge
                  // it there is only video and I cannot read anything". The one
                  // element that grew is the one an operator waiting on a step
                  // looks at least: during a wait they are watching their hands.
                  //
                  // Why not max-height, which is what this was first: with
                  // `width: 100%` and `aspect-ratio`, a max-height clamps the
                  // height and leaves the width alone, so the USED box stops
                  // being 4:3 and becomes wider. The Gazebo camera is 640×480 —
                  // exactly 4:3 — and the feed is fitted with `contain`, so a
                  // wider box pillarboxes it: black bars down both sides, and a
                  // picture smaller than before. Reported within the hour.
                  //
                  // Capping the width keeps the box at 4:3, so the feed fills
                  // it edge to edge as it always did.
                  //
                  // The cap is in vh, not vw, because what actually limits this
                  // box is the VERTICAL budget: the readouts, the countdown,
                  // Confirm and Stop need about 180px under the video, and a
                  // 4:3 box spends 0.75px of height for every px of width. A vw
                  // cap ignored that and left the wide panel with 15vw of empty
                  // surface either side of a video that had not grown — an
                  // "enlarge" button that enlarged nothing, which is the state
                  // this replaces.
                  //
                  // 64vh, and that is the ceiling rather than a preference.
                  // Measured on the reported layout: the body is ~625px, and
                  // what has to sit under the video during a wait — the
                  // Required/Detected readout, the countdown, Confirm, Stop —
                  // is ~165px once the Run section is clipped away while a step
                  // is waiting (it repeated the pill and the readout). That
                  // leaves ~460px of height, which at 4:3 is ~613px of width.
                  // 64vh lands just inside it.
                  //
                  // Past this the readouts start to scroll, and the whole point
                  // of capping was that they must not. The remaining lever is
                  // not a bigger number: the wide panel is 719x625, ratio 1.15,
                  // while the video is 1.33 — it is WIDER than the box holding
                  // it, so filling the width costs 539px of height and leaves
                  // 86px for everything else. Two columns are worse, not
                  // better: at 65/35 the video gets 467px, less than it has now.
                  maxWidth: 'min(100%, 64vh)',
                  marginInline: 'auto',
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

                {/* The dark overlay that used to sit here is gone.
                    It replaced the video with the step's message and, for a
                    button-confirmed step, the Confirm button. Two problems, one
                    cause: it could not be shown for gesture or object steps
                    (the operator has to SEE the camera to aim), so for those
                    two channels the instruction rendered nowhere at all — and
                    where it did show, it cost ~140px of vertical stack that
                    pushed STATUS and CONDITIONS below the fold, worse the wider
                    the panel got.

                    The instruction now rides in the pill over the video, the
                    same place Show message uses, for all four channels. Confirm
                    moved down next to the countdown, which is where the
                    operator is already looking to see how long they have. */}

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
                      // The wait instruction gets more room, because it is the
                      // sentence the operator has to act on before the run can
                      // go any further. Both kinds persist now — a Show
                      // message until it is dismissed or superseded — so the
                      // separation is weight and the countdown beneath, not
                      // lifetime: a step that BLOCKS reads louder than one
                      // that informs.
                      gap: videoPill.wait ? 1.1 : 0.8,
                      padding: videoPill.wait ? '10px 18px' : '6px 14px',
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
                    ) : videoPill.wait ? (
                      // The channel's mark, not the notify bell: a bell says
                      // "here is a message", and this pill says "the robot is
                      // waiting for you, this way".
                      <WaitIcon
                        size={18}
                        color={panel.primaryLight}
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
                        // `lead` for the wait, and this is the whole point of
                        // moving the instruction here rather than a demotion.
                        // The overlay it replaced set it at `lead`; rendering
                        // it at pill size would have shrunk the one sentence
                        // the operator must act on while claiming to give it
                        // more prominence.
                        fontSize: videoPill.wait
                          ? panelType.lead
                          : panelType.small,
                        color:
                          videoPill.tone === 'success'
                            ? panel.successLight
                            : panel.primaryFaint,
                        fontWeight: videoPill.wait ? 600 : 500,
                        lineHeight: 1.35,
                      }}
                    >
                      {videoPill.text}
                    </Typography>
                    {videoPill.onDismiss && (
                      <IconButton
                        size="small"
                        onClick={videoPill.onDismiss}
                        aria-label="Dismiss message"
                        sx={{
                          flexShrink: 0,
                          padding: '2px',
                          // -6px of the pill's own 14px right padding, so the
                          // glyph sits where the text would have ended rather
                          // than pushing the chip wider than the sentence.
                          marginRight: '-6px',
                          color: panel.iconMuted,
                          '&:hover': {
                            color: panel.white,
                            background: panel.hover,
                          },
                        }}
                      >
                        <X size={13} />
                      </IconButton>
                    )}
                  </Box>
                )}
              </Box>

              {/* Gesture match — only while a human step is waiting on one */}
              {/* REQUIRED / DETECTED — every perceiving channel, one card.
                  Gesture keeps its drawings; voice and object get the same
                  two columns in words. See `waitReadout` for why a channel
                  that shows what it perceives is not a nicety. */}
              {/* THE WAIT STRIP — pinned, not laid out and hoped for.
                  What is required and how long is left are the two things an
                  operator with their hands full has to read, and they were
                  ordinary flex children at the bottom of a scrolling body. The
                  space under the video is budgeted (see the 64vh cap above),
                  but the budget is not the same for every channel: a gesture
                  wait adds its two drawings, voice adds a spoken form, object
                  adds a longer name. On the channels that spend more, the
                  countdown fell below the fold and the operator had to scroll
                  to find out how long they had — while being timed.

                  `sticky bottom` removes the guess. The strip stays against
                  the foot of the body whatever sits above it, so no channel
                  can push it out of view and no future addition above can
                  either. Rendered ONLY during a wait, so between steps the
                  panel scrolls exactly as before, with no pinned empty band.

                  The negative bottom cancels the body's own 20px padding, the
                  same trick the OUTCOME slot uses at the top. It needs an
                  opaque ground of its own: content scrolls UNDER a sticky
                  element, and a transparent strip would show the video sliding
                  through the countdown. */}
              {isHumanStepActive && (
                <Box
                  sx={{
                    position: 'sticky',
                    bottom: '-20px',
                    zIndex: 3,
                    background: panel.bg,
                    paddingBottom: '20px',
                    // Only when something has actually scrolled under it —
                    // a permanent line would draw a divider across a panel
                    // that has nothing above the strip on a short step.
                    boxShadow: `0 -8px 12px -8px ${panel.bg}`,
                  }}
                >
                  {waitReadout && (
                    <Box
                      sx={{
                        mt: 1.5,
                        padding: '14px 16px',
                        background: waitReadout.match
                          ? panel.successTint(0.1)
                          : panel.primaryTint(0.07),
                        border: waitReadout.match
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
                          gap: 2,
                        }}
                      >
                        <Box sx={{ minWidth: 0 }}>
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
                              color: waitReadout.match
                                ? panel.successLight
                                : panel.primaryFaint,
                              letterSpacing: '0.02em',
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {waitReadout.required}
                          </Typography>
                          {/* The word names the gesture; the drawing is what
                          actually tells the operator what to do with their
                          hand. Under a countdown, in a second language, the
                          drawing is the faster of the two to read. Only
                          gesture has one — a spoken word and a tube have no
                          equivalent picture, and inventing one for symmetry
                          would say less than the word already does. */}
                          {RequiredGestureIcon && (
                            <RequiredGestureIcon
                              size={30}
                              color={
                                waitReadout.match
                                  ? panel.successLight
                                  : panel.primaryFaint
                              }
                              style={{ marginTop: 4 }}
                            />
                          )}
                        </Box>
                        <Box sx={{ textAlign: 'right', minWidth: 0 }}>
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
                              color: waitReadout.match
                                ? panel.successLight
                                : waitReadout.detected === '—'
                                  ? panel.textDim
                                  : panel.primaryLight,
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {waitReadout.detected}
                          </Typography>
                          {DetectedGestureIcon && (
                            <DetectedGestureIcon
                              size={30}
                              color={
                                waitReadout.match
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

                      {/* Confirm, directly under the clock it is racing.
                      It used to live inside the dark overlay, which meant it
                      only existed for channels that got an overlay — and it sat
                      mid-panel at 200px wide while Stop ran full width against
                      the bottom edge. By Fitts that made the destructive,
                      rare action the easiest target on the screen and the
                      frequent one harder, for an operator whose hands are full
                      of test tubes. Full width here, immediately below the
                      countdown, where they are already looking. */}
                      {humanStep?.condition === 'human_feedback' && (
                        <Button
                          ref={confirmButtonRef}
                          fullWidth
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
                            minHeight: 48,
                            fontSize: panelType.body,
                            fontWeight: 600,
                            textTransform: 'none',
                            // NO bgcolor override. The theme's containedPrimary is
                            // primary.dark precisely because primary.main renders
                            // white text at 4.47:1 and fails AA
                            // (themes/overrides/Button.ts) — the override that used
                            // to be here reintroduced that exact failure on the one
                            // control an operator must find under a 30-second
                            // deadline. primary.dark is 6.29:1.
                            //
                            // Not green either, though green would also pass: this
                            // panel already spends green on "Twin only", "Ready to
                            // run" and the simulate button, all meaning "safe".
                            // This is the app's primary action, so it wears the
                            // app's primary colour.
                            '&.Mui-disabled': {
                              // The theme's disabled fill is grey[200] on a white
                              // page, which on this dark panel rendered a
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
                  {/* edge="end" on all four switches in this panel. A MUI
                      Switch carries 7px of transparent padding around its
                      track, so a row that ends with one leaves its label flush
                      left and its control seven pixels short of the right
                      edge — every toggle row hanging inside the column the
                      cards beside it fill. This is the prop that exists for
                      exactly that. */}
                  <Switch
                    edge="end"
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
                      edge="end"
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
                      edge="end"
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
                        {/* The word to SAY, not only the name of the command.
                            This legend is what an operator reads while
                            testing the microphone, and it listed "Yes / No /
                            Done / Proceed" at a recognizer set to Italian —
                            so three of the four could be read aloud exactly
                            as printed and still match nothing. */}
                        {voiceLabelWithSpokenForm(v)}
                      </Typography>
                    </Box>
                  ))}
                </Stack>

                {/* Third row of the legend, and it has to be a row.

                    It read "The robot's camera looks for objects here." — in
                    the webcam sandbox, one screen below a caption that says
                    object detection here "looks for objects in this webcam
                    feed" and that real runs "use the robot camera only". Two
                    sentences on one tab naming opposite cameras.

                    It also broke the pattern it sat in. The two rows above are
                    a heading, a count and the closed list of everything the
                    system answers to. This was a loose sentence whose "here"
                    pointed at nothing, so it read as a third row whose chips
                    had failed to load. The count is the part that cannot be
                    given — objects are not a fixed vocabulary — so say that,
                    in the place a count would go. */}
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
                  Objects (no fixed list)
                </Typography>
                <Typography
                  sx={{ fontSize: panelType.micro, color: panel.muted }}
                >
                  Whatever the camera above recognises in the picture. Turn on
                  Object detection to see it name them.
                </Typography>
              </Box>
            </Box>
          )}
        </Box>

        {/* ── RUN — only on the Robot tab; the Test recognition
              sandbox is a diagnostic space with no run affordance at all ── */}
        {liveView === 'simulation' && (
          // Collapsed to nothing but its live region while a step is waiting.
          //
          // During a wait this section says what the pill over the video and
          // the Required/Detected readout have already said, one above the
          // other, and it costs about 60px of the vertical budget — the budget
          // that decides how large the video may be, because a 4:3 box spends
          // 0.75px of height for every px of width. Sixty pixels of duplicate
          // text was buying nothing and pushing the readouts towards the fold.
          //
          // Clipped, NOT unmounted and NOT `visibility: hidden`. The Typography
          // inside is this panel's live region and the ONLY announcement that a
          // human step has begun — the pill over the video is purely visual. A
          // live region removed and re-inserted is announced unreliably, and
          // `visibility: hidden` (the first thing written here) takes it out of
          // the accessibility tree altogether, which would have silenced the
          // very announcement this comment claims to protect.
          //
          // The clip pattern is the one that keeps an element announced while
          // taking no layout space, and it is already used a few lines below
          // for the countdown's "time is almost up".
          <Box
            sx={
              isHumanStepActive
                ? {
                    position: 'absolute',
                    width: 1,
                    height: 1,
                    overflow: 'hidden',
                    clip: 'rect(0 0 0 0)',
                    whiteSpace: 'nowrap',
                  }
                : undefined
            }
          >
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
                {/* The Mode row was here. It moved to the panel header, which does
                    not scroll — see the comment there for the measurements. */}

                {/* RUN SETTINGS — one collapsed row instead of three expanded ones.
                    All three below are bench preferences: each is persisted, each
                    already defaults correctly (sound ON, 30s, you answer), and each
                    is set once and then never touched. Expanded they cost ~85 words
                    and ~200px of the first viewport, permanently, between the status
                    card and the banners that qualify the run.
                    Collapsed, the summary line still answers "what will happen"
                    without opening anything, which is the only reason to read them
                    at a glance. */}
                <Box
                  sx={{
                    mb: 1,
                    borderBottom: `1px solid ${panel.hairline}`,
                  }}
                >
                  <Box
                    component="button"
                    type="button"
                    onClick={() => setRunSettingsOpen((v) => !v)}
                    aria-expanded={runSettingsOpen}
                    sx={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      padding: '10px 0',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: 'inherit',
                      '&:hover': { background: panel.hover },
                    }}
                  >
                    <ChevronRight
                      size={14}
                      color={panel.iconMuted}
                      style={{
                        transform: runSettingsOpen
                          ? 'rotate(90deg)'
                          : 'rotate(0deg)',
                        transition:
                          'transform 0.18s cubic-bezier(0.25, 1, 0.5, 1)',
                        flexShrink: 0,
                      }}
                    />
                    <Typography
                      sx={{ fontSize: panelType.body, color: panel.textDim }}
                    >
                      Run settings
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: panelType.micro,
                        color: panel.muted,
                        ml: 'auto',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {runSettingsSummary}
                    </Typography>
                  </Box>
                  <Collapse in={runSettingsOpen} unmountOnExit>
                    <Box sx={{ pb: 0.5 }}>
                      {/* Sound, on both targets and in study mode.
                    Unlike the switch below it, this is not about how a step is
                    answered — it is about whether the operator can tell that it
                    was, from wherever they happen to be standing. */}
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
                            sx={{
                              fontSize: panelType.body,
                              color: panel.textDim,
                            }}
                          >
                            Sound when a step needs you
                          </Typography>
                          <Typography
                            sx={{
                              fontSize: panelType.micro,
                              color: panel.muted,
                            }}
                          >
                            A short tone when the robot starts waiting, and
                            another when it accepts your answer. The same tone
                            for every channel.
                          </Typography>
                        </Box>
                        <Switch
                          edge="end"
                          size="small"
                          checked={sound.enabled}
                          onChange={(e) => sound.setEnabled(e.target.checked)}
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

                      {/* How long a step waits before giving up.
                    Suggested in review, and the reason is the bench rather
                    than the software: how long an operator needs depends on
                    how far the rack is and what their hands are doing, and 30
                    seconds is a guess that was right for the room it was
                    measured in. It was already settable, but only as a server
                    environment variable read at startup — which means it was
                    settable by whoever launches the stack, not by whoever uses
                    it.

                    Locked during a study session. Part B measures time to
                    resolution against a fixed budget, so a value changed
                    between participants would silently change what the numbers
                    mean; there the env variable is the single point of control
                    and it belongs to the protocol, not to the panel. */}
                      {/* Hidden outright during a study session, not shown locked.
                    A disabled field still displays a NUMBER, and in study mode
                    that number is wrong: the panel shows its own remembered
                    value while the run uses HUMAN_STEP_TIMEOUT_S from the
                    server, which this side never learns. Showing 30 next to a
                    session running at 60 is worse than showing nothing.
                    It also drew the eye hardest of anything here — a light
                    input on a dark panel — to the one control that could not
                    be used. */}
                      {!STUDY_MODE && (
                        <Stack
                          direction="row"
                          sx={{
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            mb: 1,
                          }}
                        >
                          <Box sx={{ pr: 1 }}>
                            <Typography
                              sx={{
                                fontSize: panelType.body,
                                color: panel.textDim,
                              }}
                            >
                              How long to wait for you
                            </Typography>
                            <Typography
                              sx={{
                                fontSize: panelType.micro,
                                color: panel.muted,
                              }}
                            >
                              {`Each step that needs you gives you this long before it gives up. ${MIN_HUMAN_TIMEOUT_S}–${MAX_HUMAN_TIMEOUT_S} seconds.`}
                            </Typography>
                          </Box>
                          <TextField
                            type="number"
                            size="small"
                            disabled={simulation.isRunning}
                            value={humanTimeout}
                            // Committed on blur, not on every keystroke: clamping as
                            // the operator types rewrites "8" into the minimum before
                            // they have finished typing "80".
                            onChange={(e) =>
                              setHumanTimeout(Number(e.target.value))
                            }
                            onBlur={() => {
                              const next = clampHumanTimeout(
                                Number.isFinite(humanTimeout)
                                  ? humanTimeout
                                  : DEFAULT_HUMAN_TIMEOUT_S,
                              )
                              setHumanTimeout(next)
                              localStorage.setItem(
                                HUMAN_TIMEOUT_KEY,
                                String(next),
                              )
                            }}
                            slotProps={{
                              htmlInput: {
                                min: MIN_HUMAN_TIMEOUT_S,
                                max: MAX_HUMAN_TIMEOUT_S,
                                'aria-label':
                                  'Seconds to wait for the operator',
                              },
                            }}
                            sx={{
                              width: 82,
                              flexShrink: 0,
                              '& .MuiInputBase-input': {
                                color: panel.text,
                                fontSize: panelType.body,
                                padding: '6px 8px',
                              },
                              '& .MuiOutlinedInput-notchedOutline': {
                                borderColor: panel.hairlineStrong,
                              },
                              // The panel is a dark island inside a light app, so the
                              // input needs its own ground: without this it inherits
                              // the app's light field styling and becomes the
                              // brightest element in the section.
                              '& .MuiOutlinedInput-root': {
                                background: panel.chrome,
                              },
                            }}
                          />
                        </Stack>
                      )}
                    </Box>
                  </Collapse>
                </Box>

                {/* OUTSIDE the disclosure on purpose. The branch that is not a
                    toggle is a safety notice — "the real robot will move" — and
                    a safety notice that can be collapsed is a safety notice
                    that will be. Only the switch belongs behind a disclosure;
                    the two banners are context and stay in the open.

                    Event handling folds into the target choice instead of being a
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
                      edge="end"
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
                    {/* One sentence, and it used to be two. The second —
                        "Gestures and voice commands must be performed live" —
                        is what the camera/microphone notice directly below
                        says, and that one says it only on a task that has
                        gestures or voice, names which permission Run will ask
                        for, and cannot go stale: on this target `runMode` is
                        forced to 'live', so it appears whenever the fact
                        applies. Here it was unconditional, so a task with no
                        human step at all carried a warning about gestures it
                        does not use.

                        It also cost the sentence that matters. Real robot
                        stacks more into the same body than Simulation does —
                        a longer notice, the e-stop line, an extra pre-flight
                        issue — and this banner is what the scroll fold cut in
                        half, mid-word, directly above the run button. */}
                    <PanelMessage tone="hardware" dense>
                      Live hardware — the real robot will move.
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
          {/* Blockers first, standing advice last, and that order is the point.
              These two groups answer different questions in different tenses:
              the pre-flight list says what stops the run NOW and is what
              explains a disabled button directly above it; the e-stop line is
              what to do once the arm is moving. They used to be interleaved,
              so the footer read amber, blue, amber and the operator sorted
              three messages by hand to find the one holding them up. */}
          {!simulation.isRunning &&
            (preflightIssues.length > 0 ? (
              <Stack spacing={0.6} sx={{ mt: 0.8 }}>
                {preflightIssues.map((issue, i) => (
                  <Stack
                    key={i}
                    direction="row"
                    sx={{
                      // flex-start and NO wrap. It was `center` + `wrap`, and
                      // every one of these sentences is long enough to wrap in
                      // a 360px panel — so the icon, being the first flex item,
                      // was pushed onto a line of its own above the text. All
                      // three notices rendered as a floating symbol over a
                      // centred paragraph, which reads as a layout fault
                      // exactly where the panel explains why Run is disabled.
                      alignItems: 'flex-start',
                      gap: '6px',
                      flexWrap: 'nowrap',
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
                        // Optical alignment with the first line of text, which
                        // is 13px at 1.5 line-height — the glyph's own box is
                        // shorter than the line box it sits beside.
                        style={{ flexShrink: 0, marginTop: 4 }}
                      />
                    ) : (
                      <Info
                        size={12}
                        color={panel.primaryLight}
                        style={{ flexShrink: 0, marginTop: 4 }}
                      />
                    )}
                    <Typography
                      sx={{
                        fontSize: panelType.small,
                        color:
                          issue.tone === 'hardware'
                            ? panel.warningLight
                            : panel.textDim,
                        // Left, now that the icon stays on the first line: a
                        // paragraph centred beside a left-pinned icon is ragged
                        // on both edges and starts at a different x on every
                        // line.
                        textAlign: 'left',
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
          {/* Last, and outside the `!isRunning` gate above on purpose: this is
              the only line here that matters MORE once the arm is moving, and
              a previous version of this panel put every amber cue behind that
              gate — so all of them unmounted at the moment the arm started. */}
          {executionTarget === 'real' && (
            <Stack
              direction="row"
              spacing={0.6}
              sx={{ alignItems: 'flex-start', mt: 1 }}
            >
              <AlertTriangle
                size={13}
                color={panel.warning}
                style={{ flexShrink: 0, marginTop: 3 }}
              />
              <Typography
                sx={{
                  fontSize: panelType.small,
                  fontWeight: 500,
                  color: panel.warningLight,
                  textAlign: 'left',
                }}
              >
                Use the teach-pendant e-stop to stop the arm immediately.
              </Typography>
            </Stack>
          )}
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
