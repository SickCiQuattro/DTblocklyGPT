import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box,
  Typography,
  IconButton,
  Button,
  Chip,
  Tooltip,
} from '@mui/material'
import { useTheme, alpha } from '@mui/material/styles'
import { X, ArrowLeftRight, Sparkles } from 'lucide-react'
import { useDispatch } from 'react-redux'
import useSWR from 'swr'
import dayjs from 'dayjs'
import * as Blockly from 'blockly/core'

import { useSpeechRecognition } from 'utils/speechRecognition'
import {
  computeConformance,
  formatIssue,
} from 'features/blockly/utils/conformance'
import { useAppSelector } from 'store/reducers'
import { clearProposedTask, setProposedTask } from 'store/reducers/proposal'
import { toggleChatPosition } from 'store/reducers/task'
import { endpoints } from 'services/endpoints'
import { MethodHTTP, fetchApi } from 'services/api'
import {
  MessageType,
  UserChatEnum,
  MessageTypeEnum,
  INITIAL_MESSAGE_1,
  CHATGPT_ERROR,
  ChatResponse,
} from 'utils/chat'
import { ObjectListType } from 'pages/objects/types'
import { LocationListType } from 'pages/locations/types'
import { ActionListType } from 'pages/actions/types'
import { buildBlockCatalog } from 'features/blockly/toolbox'
import { AbstractStep } from 'pages/tasks/types'
import { getFromLocalStorage, LocalStorageKey } from 'utils/localStorageUtils'
import { UserLoginInterface } from 'pages/login/LoginForm'
import { ConfirmDialog } from 'components/ConfirmDialog'
import { UI_TEXT } from 'constants/uiVocabulary'

import { UserBubble } from './UserBubble'
import { AssistantBubble } from './AssistantBubble'
import { ChatComposer } from './ChatComposer'
import { TaskPreviewCard } from './TaskPreviewCard'
import { EvaluationCard } from './EvaluationCard'

interface ChatThreadProps {
  taskId: string | null
  taskStructure: any[]
  /** Live editor workspace — used only to compute conformance for the
   * contextual welcome/proactive-help feature. Not required otherwise. */
  workspace?: Blockly.WorkspaceSvg | null
  onApplyProposedTask?: (proposedTask: any[]) => void
  onClose?: () => void
}

const normalizeStep = (step: any): any => {
  if (!step || typeof step !== 'object') return step
  if (Array.isArray(step)) {
    return step.map(normalizeStep)
  }
  const cleaned: any = {}
  const keys = Object.keys(step).sort()
  for (const key of keys) {
    let val = step[key]
    if (val === null || val === undefined) continue
    if (Array.isArray(val) && val.length === 0) continue

    if (
      (key.endsWith('Id') || key === 'seconds' || key === 'times') &&
      typeof val === 'string' &&
      /^\d+$/.test(val)
    ) {
      val = Number(val)
    }

    cleaned[key] = normalizeStep(val)
  }
  return cleaned
}

const areStepsIdentical = (a: any, b: any) => {
  return JSON.stringify(normalizeStep(a)) === JSON.stringify(normalizeStep(b))
}

export const ChatThread: React.FC<ChatThreadProps> = ({
  taskId,
  taskStructure,
  workspace,
  onApplyProposedTask,
  onClose,
}) => {
  const theme = useTheme()
  const indigo = theme.palette.primary.main
  const dispatch = useDispatch()
  const storedUser = getFromLocalStorage(LocalStorageKey.USER) as
    Partial<UserLoginInterface> | ''
  const userName =
    typeof storedUser === 'object' && storedUser !== null
      ? storedUser.username || 'You'
      : 'You'
  const proposal = useAppSelector((state) => state.proposal)
  const chatOpen = useAppSelector((state) => state.task.chatOpen)
  const chatPosition =
    useAppSelector((state) => state.task.chatPosition) || 'right'
  const chatEndRef = useRef<HTMLDivElement>(null)

  const [width, setWidth] = useState(360)
  const [isResizing, setIsResizing] = useState(false)

  // Publish the footprint so the robot panel can leave the workspace a floor.
  //
  // That panel is `position: fixed`, so it cannot learn from flex how much room
  // is left; and this width lives in local state, not Redux, so it cannot read
  // it either. A custom property is the channel the app already uses for the
  // same kind of cross-layout fact (--layout-appbar-height, consumed by the
  // panel's own `top`).
  //
  // Zero when closed, and set during a drag too: the panel clamps on every
  // frame of the resize, so the workspace cannot be squeezed below its minimum
  // even momentarily.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty(
      '--copilot-width',
      chatOpen ? `${width + 12}px` : '0px',
    )
    return () => {
      root.style.removeProperty('--copilot-width')
    }
  }, [chatOpen, width])
  const [showProposalOverlay, setShowProposalOverlay] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  // Applying a proposal replaces the whole workspace (chatSync.ts disposes
  // every existing top-level block first) — confirm before doing that to
  // an operator's own work, not just to an empty canvas.
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false)
  const [listMessages, setListMessages] = useState<MessageType[]>([
    INITIAL_MESSAGE_1,
  ])
  const [chatLog, setChatLog] = useState<any[]>([])
  const [message, setMessage] = useState('')
  const [isRecording, setIsRecording] = useState(false)

  // Contextual help — persisted like chatOpen/chatPosition. Governs both the
  // dynamic welcome message (computed locally, zero token cost) and the one
  // proactive LLM analysis call per task open (the only part that actually
  // spends tokens) — this is the switch a user flips off during test/dev
  // sessions to stop that call firing.
  const [contextualHelpEnabled, setContextualHelpEnabled] = useState(
    () =>
      (typeof window !== 'undefined'
        ? localStorage.getItem('contextualHelpEnabled')
        : null) !== 'false',
  )
  const toggleContextualHelp = () => {
    setContextualHelpEnabled((prev) => {
      const next = !prev
      if (typeof window !== 'undefined') {
        localStorage.setItem('contextualHelpEnabled', String(next))
      }
      return next
    })
  }

  const {
    transcript,
    resetTranscript,
    browserSupportsSpeechRecognition,
    isMicrophoneAvailable,
  } = useSpeechRecognition()

  // SWR local fetches for self-containment
  const { data: dataObjects = [] } = useSWR<ObjectListType[], Error>({
    url: endpoints.graphic.objectsGraphic,
  })
  const { data: dataActions = [] } = useSWR<ActionListType[], Error>({
    url: endpoints.graphic.actionsGraphic,
  })
  const { data: dataLocations = [] } = useSWR<LocationListType[], Error>({
    url: endpoints.graphic.locationsGraphic,
  })
  // The assistant's Saved Task catalogue. Same SWR key the toolbox and the
  // robot panel already hold, so this costs no request. Without it the prompt
  // told the model that a "Saved Tasks" category exists and never said what is
  // in it — and a user asking to reuse one got an invented saved task back,
  // reported as added.
  const { data: dataMacros = [] } = useSWR<
    { id: number; name: string; description?: string }[],
    Error
  >({ url: endpoints.graphic.macroList })

  // Starters for the opening state, built from the operator's own catalogue
  // rather than written down here.
  //
  // The panel opened with one welcome bubble, a composer, and roughly half its
  // height empty. Its only affordance was a text field, and the welcome's
  // answer to "what do I type" was a worked example to retype by hand. An
  // operator who does not program reads that as a blank page — and the
  // observed behaviour in testing is that they look for something to press,
  // then look elsewhere when they do not find it.
  //
  // Reading the live catalogue rather than hardcoding nouns also means these
  // cannot go stale: the welcome text in utils/chat.ts carries names that have
  // to be kept in step with seed_library by hand, and these name whatever this
  // operator actually has.
  const starterPrompts = React.useMemo(() => {
    const object = dataObjects[0]?.name
    const location = dataLocations[0]?.name
    return [
      object && location
        ? `Pick up the ${object} and place it on the ${location}`
        : null,
      'Repeat the whole task 4 times',
      'Wait for a thumbs up before continuing',
    ].filter((prompt): prompt is string => Boolean(prompt))
  }, [dataObjects, dataLocations])

  // Auto-open overlay when a new proposal is received
  const prevProposedTaskRef = useRef<any>(null)
  const proposalOverlayRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (proposal.proposedTask && !prevProposedTaskRef.current) {
      setShowProposalOverlay(true)
      // Move focus onto the overlay. This is the direct answer to something
      // the user just asked for, so following it with focus is what they
      // expect — the same reason a search result list takes focus. The
      // container itself is the target rather than a button inside it, so the
      // region's label is read first and nothing is activated by accident.
      requestAnimationFrame(() => proposalOverlayRef.current?.focus())
    } else if (!proposal.proposedTask) {
      setShowProposalOverlay(false)
    }
    prevProposedTaskRef.current = proposal.proposedTask
  }, [proposal.proposedTask])

  const startResizing = React.useCallback(
    (pointerDownEvent: React.PointerEvent) => {
      pointerDownEvent.preventDefault()
      setIsResizing(true)
      const startWidth = width
      const startX = pointerDownEvent.clientX

      const handlePointerMove = (pointerMoveEvent: PointerEvent) => {
        const delta = pointerMoveEvent.clientX - startX
        const newWidth =
          chatPosition === 'left' ? startWidth + delta : startWidth - delta
        if (newWidth >= 320 && newWidth <= 600) {
          setWidth(newWidth)
        }
      }

      // pointercancel, not just pointerup: under touch the system can take the
      // pointer away mid-gesture and pointerup never fires, leaving the move
      // listener attached and the divider stuck in its resizing state.
      const handlePointerEnd = () => {
        setIsResizing(false)
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerEnd)
        window.removeEventListener('pointercancel', handlePointerEnd)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerEnd)
      window.addEventListener('pointercancel', handlePointerEnd)
    },
    [width, chatPosition],
  )

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [listMessages])

  // Shared by a normal send and the proactive-help call below: append the
  // assistant's reply to whatever message list preceded it, and apply the
  // same task-proposal handling either way.
  const applyAssistantResponse = (
    res: ChatResponse,
    priorMessages: MessageType[],
  ) => {
    const answerText = res.response.answer || CHATGPT_ERROR
    const intent = res.intent ?? res.response.intent
    // Suggestions + warnings render as typed chips below the text.
    const parts = (res.messageParts ?? []).filter((p) => p.type !== 'text')

    const newRobotMessage: MessageType = {
      text: answerText,
      id: (priorMessages[priorMessages.length - 1]?.id ?? 0) + 1,
      user: UserChatEnum.ROBOT,
      timestamp: dayjs().toISOString(),
      type: MessageTypeEnum.TEXT,
      parts,
      intent,
      lang: res.response.lang,
    }

    setListMessages([...priorMessages, newRobotMessage])
    setChatLog(res.chatLog)

    const taskModified = res.response?.taskModified ?? true

    if (!taskModified) {
      dispatch(clearProposedTask())
    } else {
      const isIdentical = areStepsIdentical(res.response.task, taskStructure)

      if (isIdentical) {
        dispatch(clearProposedTask())
      } else if (
        Array.isArray(res.response.task) &&
        res.response.task.length > 0
      ) {
        dispatch(
          setProposedTask({
            proposedTask: res.response.task,
            validationWarnings: res.response.validationWarnings || [],
            answer: res.response.answer || '',
          }),
        )
      } else {
        dispatch(clearProposedTask())
      }
    }
  }

  // Discarding a proposal has to leave a trace in the transcript. The
  // assistant's own message is written before the user has decided anything,
  // and models phrase it as done ("I updated the pick step…"), so dismissing
  // the proposal used to leave that claim standing as the last thing said —
  // the history then read as though the change had been made. Two entry points
  // reach here: the card's Cancel and the collapsed badge's ✕.
  const discardProposal = useCallback(() => {
    dispatch(clearProposedTask())
    setListMessages((prev) => [
      ...prev,
      {
        id: (prev[prev.length - 1]?.id ?? 0) + 1,
        text: 'Discarded that suggestion — your task is unchanged.',
        user: UserChatEnum.ROBOT,
        timestamp: dayjs().toISOString(),
        type: MessageTypeEnum.TEXT,
      },
    ])
  }, [dispatch])

  // One send path for three entry points: the composer, a starter chip in the
  // opening state, and a suggestion chip inside an assistant reply. The text
  // is a parameter rather than read from `message` state — the chip paths
  // never put their text in the field, and a chip wired straight to a click
  // handler would otherwise hand the click event in as the message.
  const sendText = async (rawText: string) => {
    const text = rawText.trim()
    if (!text || isProcessing) return

    const newUserMessage: MessageType = {
      text,
      id: listMessages[listMessages.length - 1].id + 1,
      user: UserChatEnum.USER,
      timestamp: dayjs().toISOString(),
      type: MessageTypeEnum.TEXT,
    }
    const messagesWithUserRequest = [...listMessages, newUserMessage]
    setListMessages(messagesWithUserRequest)
    setIsProcessing(true)
    setMessage('')

    try {
      const res: ChatResponse = await fetchApi({
        url: endpoints.chat.newMessageMultimodal,
        method: MethodHTTP.POST,
        body: {
          id: Number(taskId),
          message: text,
          chatLog,
          dataObjects,
          dataLocations,
          dataActions,
          dataMacros,
          dataBlocks: buildBlockCatalog(),
          taskStructure: taskStructure,
        },
      })

      if (res) applyAssistantResponse(res, messagesWithUserRequest)
    } catch (error) {
      // fetchApi already toasts every failure path (services/api.ts) — a
      // second toast here just stacks a redundant message behind it.
      console.error('Error sending message:', error)
      // Restore into the composer whatever failed to send, including a chip's
      // text — the operator can retry or edit it rather than hunt for the chip
      // again, which may no longer be on screen.
      setMessage(text)
    } finally {
      setIsProcessing(false)
    }
  }

  const onMessageSend = () => void sendText(message)

  // Contextual help, part 2 — the one LLM call this feature actually spends
  // tokens on. Fires at most once per task open, only when the workspace has
  // conformance issues and the toggle above is on. No synthetic user bubble:
  // the operator didn't type this, so only the assistant's reply is shown.
  // `priorMessages` is passed explicitly (not read from `listMessages` state)
  // because the caller just replaced that state synchronously moments
  // earlier with the dynamic welcome text — reading the closed-over state
  // here would still see the pre-update array and silently drop that edit
  // once this response lands.
  const requestProactiveHelp = async (
    issueTexts: string[],
    priorMessages: MessageType[],
    localSummary: string,
  ) => {
    setIsProcessing(true)
    try {
      const res: ChatResponse = await fetchApi({
        url: endpoints.chat.newMessageMultimodal,
        method: MethodHTTP.POST,
        body: {
          id: Number(taskId),
          message: `The workspace has unresolved steps: ${issueTexts.join(' ')} Help me fix them.`,
          chatLog,
          dataObjects,
          dataLocations,
          dataActions,
          dataMacros,
          dataBlocks: buildBlockCatalog(),
          taskStructure: taskStructure,
        },
      })
      if (res) applyAssistantResponse(res, priorMessages)
    } catch (error) {
      console.error('Error requesting proactive help:', error)
      // This call is automatic (the operator never asked for it), so the
      // typing indicator disappearing with no reply at all would look like
      // Copilot just stopped responding — say so and suggest the fallback.
      setListMessages([
        ...priorMessages,
        {
          // Fall back to what conformance already worked out locally. This
          // used to be a bare apology, which threw away the one thing that
          // had cost nothing and was known to be true.
          text: `${localSummary} I couldn't look at it in more detail just now — tell me what the robot should do and I'll help.`,
          id: (priorMessages[priorMessages.length - 1]?.id ?? 0) + 1,
          user: UserChatEnum.ROBOT,
          timestamp: dayjs().toISOString(),
          type: MessageTypeEnum.TEXT,
          parts: [],
        },
      ])
    } finally {
      setIsProcessing(false)
    }
  }

  // Contextual welcome — seeded once per task, when the workspace is
  // available. Conformance runs locally and costs nothing; if it finds
  // anything, it kicks off the one proactive LLM call above. A short delay
  // covers the gap between the workspace becoming available (injection) and
  // the task's saved blocks finishing their load into it, since conformance
  // read too early would misreport an existing task as empty.
  //
  // The local summary is NOT posted as its own bubble any more. It used to be,
  // and the proactive call then appended a second bubble about the same block
  // one second later — two Copilot messages on the same timestamp, both saying
  // something was unfinished. The LLM's is strictly the better of the two: it
  // names which step and offers the fix as a chip. So the local text is held
  // back and spent only where it is the best available answer, which is when
  // that call fails.
  const hasSeededWelcomeRef = useRef(false)
  useEffect(() => {
    if (hasSeededWelcomeRef.current) return
    if (!workspace || !contextualHelpEnabled) return

    // Latch only once the timeout actually fires, not when it's scheduled —
    // if `workspace`'s reference changes again before then (Blockly can
    // dispose/re-inject during the task load), the cleanup below cancels
    // this attempt and a fresh effect run reschedules against the new
    // reference instead of silently giving up.
    const t = setTimeout(() => {
      hasSeededWelcomeRef.current = true
      const result = computeConformance(workspace)
      const issueTexts = result.errors.map(formatIssue)
      if (issueTexts.length === 0) return // clean workspace: default opener stays

      const localSummary =
        issueTexts.length === 1
          ? `I can see one thing to finish here: ${issueTexts[0]}`
          : `I can see ${issueTexts.length} things to finish here: ${issueTexts.join(' ')}`
      void requestProactiveHelp(issueTexts, [INITIAL_MESSAGE_1], localSummary)
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [workspace, contextualHelpEnabled])

  const renderMessage = (msg: MessageType) => {
    if (msg.user === UserChatEnum.USER) {
      return (
        <UserBubble
          key={msg.id}
          text={msg.text}
          timestamp={msg.timestamp}
          user={userName}
          avatarUrl="/pages/user.png"
        />
      )
    } else {
      return (
        <React.Fragment key={msg.id}>
          <AssistantBubble
            text={msg.text}
            lang={msg.lang}
            timestamp={msg.timestamp}
            avatarUrl="/pages/robot.png"
            parts={msg.parts}
            onSuggestionClick={(text) => void sendText(text)}
            suggestionsDisabled={isProcessing}
          />
          {msg.intent === 'evaluate' && (
            <EvaluationCard
              task={{
                taskName: '',
                steps: taskStructure as AbstractStep[],
                objects: dataObjects,
                locations: dataLocations,
                actions: dataActions,
              }}
            />
          )}
        </React.Fragment>
      )
    }
  }

  const renderTypingIndicator = () => {
    return (
      <div
        className="assistant-bubble-premium"
        role="status"
        aria-live="polite"
        aria-label="Copilot is typing"
        style={{
          margin: '8px 0',
          width: '74px',
          alignSelf: 'flex-start',
          background: 'rgba(16, 185, 129, 0.06)',
          border: '1px solid rgba(16, 185, 129, 0.14)',
          borderRadius: '16px 16px 16px 4px',
          padding: '12px 16px',
          boxShadow: '0 2px 8px rgba(16, 185, 129, 0.03)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          aria-hidden="true"
          style={{ display: 'flex', gap: '5px', alignItems: 'center' }}
        >
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
      </div>
    )
  }

  return (
    <Box
      // Collapsed to width:0 rather than unmounted — inert keeps its
      // contents out of the tab order and the accessibility tree while
      // collapsed, not just visually clipped.
      inert={!chatOpen}
      sx={{
        position: 'relative',
        width: chatOpen ? width : 0,
        minWidth: chatOpen ? width : 0,
        // A zero-width flex child still gets the row's `gap`, so cancel it —
        // on the ONE side the gap is actually on.
        //
        // The first attempt split it symmetrically, half on each side. A gap
        // sits between two children, not around one: with Copilot on the right
        // the whole 12px is to its left, so halving it left 6px unaccounted for
        // on that side and pulled the row's content edge 6px the wrong way. The
        // visible result was double spacing between the workspace and the robot
        // panel, exactly where it was supposed to be single.
        //
        // Which side depends on `order`, so the margin follows it.
        ...(chatOpen
          ? { marginInlineStart: 0, marginInlineEnd: 0 }
          : chatPosition === 'left'
            ? { marginInlineEnd: 'calc(var(--layout-gutter) * -1)' }
            : { marginInlineStart: 'calc(var(--layout-gutter) * -1)' }),
        order: chatPosition === 'left' ? 1 : 2,
        transition: isResizing
          ? 'none'
          : 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden',
        background: theme.palette.background.paper,
        // Conditional HERE, not in a spread above the base properties.
        //
        // `width: 0` alone does not hide this panel: with box-sizing
        // border-box the 1px border on each side still draws, so the collapsed
        // Copilot rendered as a 2px vertical rule between the workspace and the
        // robot panel — read as a third surface, or as a seam.
        //
        // The first attempt put `border: 'none'` in a conditional spread placed
        // ABOVE this line. In an object literal the later key wins, so this one
        // overwrote it and the rule stayed on screen. Same reason it has to be
        // the base declaration that branches, not an override sitting earlier.
        border: chatOpen ? `1px solid ${theme.palette.divider}` : 'none',
        borderRadius: '16px',
        boxShadow: chatOpen ? theme.customShadows.card : 'none',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      <style>{`
        .resize-handle {
          transition: background 0.15s ease !important;
        }
        .resize-handle:hover, .resize-handle:active {
          background: ${alpha(theme.palette.primary.main, 0.3)} !important;
        }
        .chat-messages-container {
          scrollbar-width: thin;
          scrollbar-color: ${theme.palette.slate[300]} transparent;
        }
        .chat-messages-container::-webkit-scrollbar {
          width: 5px !important;
        }
        .chat-messages-container::-webkit-scrollbar-track {
          background: transparent !important;
        }
        .chat-messages-container::-webkit-scrollbar-thumb {
          background: ${theme.palette.slate[300]} !important;
          border-radius: 10px !important;
        }
        .chat-messages-container::-webkit-scrollbar-thumb:hover {
          background: ${theme.palette.slate[400]} !important;
        }
        .starter-chip {
          text-align: left;
          font: inherit;
          font-size: 13px;
          color: ${theme.palette.slate[700]};
          background: ${theme.palette.background.paper};
          border: 1px solid ${theme.palette.divider};
          border-radius: 10px;
          padding: 9px 12px;
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .starter-chip:hover {
          background: ${alpha(theme.palette.primary.main, 0.06)};
          border-color: ${alpha(theme.palette.primary.main, 0.3)};
        }
        .starter-chip:active {
          transform: scale(0.99);
        }
        .close-btn-premium:hover {
          background: ${alpha(theme.palette.primary.main, 0.08)} !important;
        }
        @keyframes typing-dot-bounce {
          0%, 100% {
            transform: translateY(0);
            opacity: 0.4;
          }
          50% {
            transform: translateY(-4px);
            opacity: 1;
          }
        }
        .typing-dot {
          width: 6px;
          height: 6px;
          background-color: ${theme.palette.success.main};
          border-radius: 50%;
          display: inline-block;
          animation: typing-dot-bounce 1.4s infinite ease-in-out both;
        }
        .typing-dot:nth-child(1) {
          animation-delay: -0.32s;
        }
        .typing-dot:nth-child(2) {
          animation-delay: -0.16s;
        }
      `}</style>

      {chatOpen && (
        // role="separator" + tabIndex + aria-valuenow is the WAI-ARIA APG
        // "Window Splitter" pattern (spec-correct for a resize handle, not a
        // workaround) — jsx-a11y's interactive-roles list doesn't special-case it.
        /* eslint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */
        <div
          onPointerDown={startResizing}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Copilot panel"
          aria-valuenow={width}
          aria-valuemin={320}
          aria-valuemax={600}
          tabIndex={0}
          onKeyDown={(e) => {
            const STEP = 16
            const delta =
              e.key === 'ArrowRight'
                ? chatPosition === 'left'
                  ? STEP
                  : -STEP
                : e.key === 'ArrowLeft'
                  ? chatPosition === 'left'
                    ? -STEP
                    : STEP
                  : null
            if (delta === null) return
            e.preventDefault()
            setWidth(Math.min(600, Math.max(320, width + delta)))
          }}
          style={{
            position: 'absolute',
            top: 0,
            left: chatPosition === 'right' ? 0 : 'auto',
            right: chatPosition === 'left' ? 0 : 'auto',
            width: '6px',
            height: '100%',
            cursor: 'col-resize',
            zIndex: 100,
            // Without this the browser claims the gesture for page scrolling
            // and the drag never reaches the handler on a touch screen.
            touchAction: 'none',
            background: 'transparent',
          }}
          className="resize-handle"
        />
        /* eslint-enable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */
      )}

      {/* Fixed at the resizable `width` regardless of the outer Box's
          current (possibly animating-shut) width — the outer box is what
          clips via its own overflow:hidden. Without this split, closing
          Copilot forced every message/label to reflow at each intermediate
          width, wrapping and stacking its own text before disappearing
          instead of just sliding out of a clipped window (same fix as
          CustomToolbox's collapse — see CustomToolbox.css). */}
      <div
        style={{
          width: `${width}px`,
          minWidth: `${width}px`,
          height: '100%',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            minHeight: '56px',
            padding: '6px 12px',
            borderBottom: `1px solid ${theme.palette.divider}`,
            background: theme.palette.grey[50],
          }}
        >
          <div
            style={{
              color: theme.palette.slate[600],
              fontSize: '0.74rem',
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          >
            {UI_TEXT.copilot}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <Tooltip
              title={
                contextualHelpEnabled
                  ? UI_TEXT.copilotAutoCheckOn
                  : UI_TEXT.copilotAutoCheckOff
              }
              placement="bottom"
            >
              <IconButton
                onClick={toggleContextualHelp}
                size="small"
                aria-label={
                  contextualHelpEnabled
                    ? UI_TEXT.copilotAutoCheckTurnOff
                    : UI_TEXT.copilotAutoCheckTurnOn
                }
                sx={{
                  color: contextualHelpEnabled
                    ? indigo
                    : theme.palette.slate[400],
                  '&:hover': {
                    background: alpha(indigo, 0.08),
                  },
                }}
              >
                <Sparkles
                  size={17}
                  fill={contextualHelpEnabled ? indigo : 'none'}
                />
              </IconButton>
            </Tooltip>
            <Tooltip
              title={chatPosition === 'left' ? 'Move to right' : 'Move to left'}
              placement="bottom"
            >
              <IconButton
                onClick={() => dispatch(toggleChatPosition())}
                size="small"
                aria-label={
                  chatPosition === 'left' ? 'Move to right' : 'Move to left'
                }
                sx={{
                  color: indigo,
                  '&:hover': {
                    background: alpha(indigo, 0.08),
                  },
                }}
              >
                <ArrowLeftRight size={18} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Close chat" placement="bottom">
              <IconButton
                onClick={onClose}
                size="small"
                className="close-btn-premium"
                aria-label="Close chat"
              >
                <X size={18} style={{ color: indigo }} />
              </IconButton>
            </Tooltip>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            className="chat-messages-container"
            // role="log" makes each newly appended message announce itself.
            // Previously only the "Copilot is typing" placeholder was in a live
            // region, so a screen-reader user was told the answer was coming
            // and then never told it had arrived. The typing indicator keeps
            // its own aria-live, so it still announces itself and the answer is
            // not announced twice.
            role="log"
            aria-live="polite"
            aria-label="Conversation with Copilot"
            // Scrollable region with no focusable children of its own: without
            // a tab stop the transcript can only be scrolled with a mouse.
            // jsx-a11y flags tabIndex on non-interactive elements, but a
            // scrollable container is the documented exception — 2.1.1 requires
            // it to be reachable, and the rule's allow-list predates that.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            style={{
              flex: 1,
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            {listMessages.map(renderMessage)}
            {/* Opening state only. These are an empty state, not a toolbar:
                once the conversation has started, the transcript is the thing
                worth the room. */}
            {listMessages.length <= 1 &&
              !isProcessing &&
              !proposal.proposedTask && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    marginTop: '4px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: theme.palette.slate[500],
                      marginBottom: '2px',
                    }}
                  >
                    {UI_TEXT.copilotStarters}
                  </div>
                  {starterPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="starter-chip"
                      onClick={() => void sendText(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
            {isProcessing && renderTypingIndicator()}
            <div ref={chatEndRef} />
          </div>

          {/* Proposal Details Slide-Up Overlay */}
          {proposal.proposedTask && (
            <div
              className={`proposal-overlay ${
                showProposalOverlay ? 'overlay-open' : ''
              }`}
              ref={proposalOverlayRef}
              // The overlay slides up over the transcript with no announcement
              // and no focus change, so a keyboard user had to guess that
              // something had appeared and Tab forward hunting for Apply.
              role="region"
              aria-label="Proposed task"
              tabIndex={-1}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 90,
                background: theme.palette.background.paper,
                transform: showProposalOverlay
                  ? 'translateY(0)'
                  : 'translateY(100%)',
                transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <TaskPreviewCard
                proposedTask={proposal.proposedTask}
                validationWarnings={proposal.validationWarnings}
                answer={proposal.answer}
                dataObjects={dataObjects}
                dataLocations={dataLocations}
                dataActions={dataActions}
                onApply={() => {
                  const hasExistingBlocks =
                    (workspace?.getTopBlocks(false).length ?? 0) > 0
                  if (hasExistingBlocks) {
                    setConfirmReplaceOpen(true)
                    return
                  }
                  if (onApplyProposedTask && proposal.proposedTask) {
                    onApplyProposedTask(proposal.proposedTask)
                  }
                  dispatch(clearProposedTask())
                }}
                onCancel={discardProposal}
                onBack={() => setShowProposalOverlay(false)}
              />
            </div>
          )}
        </div>

        {proposal.proposedTask && !showProposalOverlay && (
          <div
            className="proposal-floating-badge"
            style={{
              margin: '0 20px 8px 20px',
              background: 'rgba(99, 102, 241, 0.08)',
              border: '1px solid rgba(99, 102, 241, 0.16)',
              borderRadius: '10px',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              backdropFilter: 'blur(8px)',
              boxShadow: '0 4px 12px rgba(99, 102, 241, 0.04)',
            }}
          >
            <style>{`
            @keyframes badge-entrance {
              from { opacity: 0; transform: translateY(8px); }
              to { opacity: 1; transform: translateY(0); }
            }
            .proposal-floating-badge {
              animation: badge-entrance 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
            }
            .badge-action-btn {
              background: ${indigo};
              color: white;
              border: none;
              padding: 6px 12px;
              border-radius: 6px;
              font-size: 12px;
              font-weight: 500;
              cursor: pointer;
              transition: all 0.2s;
            }
            .badge-action-btn:hover {
              background: ${theme.palette.primary.dark};
              transform: scale(1.02);
            }
            .badge-action-btn:active {
              transform: scale(0.98);
            }
          `}</style>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  backgroundColor: indigo,
                  borderRadius: '50%',
                  display: 'inline-block',
                  boxShadow: `0 0 8px ${indigo}`,
                }}
              />
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: theme.palette.text.primary,
                }}
              >
                New blocks proposed
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                onClick={() => setShowProposalOverlay(true)}
                className="badge-action-btn"
              >
                Review
              </button>
              <button
                onClick={discardProposal}
                style={{
                  background: 'none',
                  border: 'none',
                  color: theme.palette.slate[400],
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '4px',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.color = theme.palette.error.main)
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = theme.palette.slate[400])
                }
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        <ChatComposer
          isProcessing={isProcessing}
          message={message}
          setMessage={setMessage}
          isRecording={isRecording}
          setIsRecording={setIsRecording}
          transcript={transcript}
          resetTranscript={resetTranscript}
          browserSupportsSpeechRecognition={browserSupportsSpeechRecognition}
          isMicrophoneAvailable={isMicrophoneAvailable}
          onMessageSend={onMessageSend}
        />

        <ConfirmDialog
          open={confirmReplaceOpen}
          title="Replace your blocks?"
          message="Applying this proposal replaces everything currently in the workspace — your existing blocks will be gone."
          confirmLabel="Replace"
          tone="danger"
          onConfirm={() => {
            setConfirmReplaceOpen(false)
            if (onApplyProposedTask && proposal.proposedTask) {
              onApplyProposedTask(proposal.proposedTask)
            }
            dispatch(clearProposedTask())
          }}
          onCancel={() => setConfirmReplaceOpen(false)}
        />
      </div>
    </Box>
  )
}
