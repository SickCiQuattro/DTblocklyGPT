import React, { useEffect, useRef, useState } from 'react'
import {
  Box,
  Typography,
  IconButton,
  Button,
  Chip,
  Tooltip,
} from '@mui/material'
import { useTheme, alpha } from '@mui/material/styles'
import { X, ArrowLeftRight } from 'lucide-react'
import { useDispatch } from 'react-redux'
import useSWR from 'swr'
import dayjs from 'dayjs'

import { useSpeechRecognition } from 'utils/speechRecognition'
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
import { abstractToBlockly } from 'utils/blocklyParser'
import { buildBlockCatalog } from 'features/blockly/toolbox'
import { AbstractStep } from 'pages/tasks/types'

import { UserBubble } from './UserBubble'
import { AssistantBubble } from './AssistantBubble'
import { ChatComposer } from './ChatComposer'
import { TaskPreviewCard } from './TaskPreviewCard'
import { EvaluationCard } from './EvaluationCard'

export type BlockGeneratedPayload = {
  blockType: string
  blockXml: string
  insertAt?: 'end' | 'cursor'
}

interface ChatThreadProps {
  taskId: string | null
  taskStructure: any[]
  onBlocksGenerated?: (blocks: BlockGeneratedPayload[]) => void
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
  onBlocksGenerated,
  onApplyProposedTask,
  onClose,
}) => {
  const theme = useTheme()
  const indigo = theme.palette.primary.main
  const dispatch = useDispatch()
  const proposal = useAppSelector((state) => state.proposal)
  const chatOpen = useAppSelector((state) => state.task.chatOpen)
  const chatPosition =
    useAppSelector((state) => state.task.chatPosition) || 'right'
  const chatEndRef = useRef<HTMLDivElement>(null)

  const [width, setWidth] = useState(360)
  const [isResizing, setIsResizing] = useState(false)
  const [showProposalOverlay, setShowProposalOverlay] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [listMessages, setListMessages] = useState<MessageType[]>([
    INITIAL_MESSAGE_1,
  ])
  const [chatLog, setChatLog] = useState<any[]>([])
  const [message, setMessage] = useState('')
  const [isRecording, setIsRecording] = useState(false)

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

  // Auto-open overlay when a new proposal is received
  const prevProposedTaskRef = useRef<any>(null)
  useEffect(() => {
    if (proposal.proposedTask && !prevProposedTaskRef.current) {
      setShowProposalOverlay(true)
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

      const handlePointerUp = () => {
        setIsResizing(false)
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    },
    [width, chatPosition],
  )

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [listMessages])

  const onMessageSend = async () => {
    if (!message.trim() || isProcessing) return

    const newUserMessage: MessageType = {
      text: message,
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
          message,
          chatLog,
          dataObjects,
          dataLocations,
          dataActions,
          dataBlocks: buildBlockCatalog(),
          taskStructure: taskStructure,
        },
      })

      if (res) {
        const answerText = res.response.answer || CHATGPT_ERROR
        const intent = res.intent ?? res.response.intent
        // Suggestions + warnings render as typed chips below the text.
        const parts = (res.messageParts ?? []).filter((p) => p.type !== 'text')

        const newRobotMessage: MessageType = {
          text: answerText,
          id:
            messagesWithUserRequest[messagesWithUserRequest.length - 1].id + 1,
          user: UserChatEnum.ROBOT,
          timestamp: dayjs().toISOString(),
          type: MessageTypeEnum.TEXT,
          parts,
          intent,
        }

        setListMessages([...messagesWithUserRequest, newRobotMessage])
        setChatLog(res.chatLog)

        const taskModified = res.response?.taskModified ?? true

        if (!taskModified) {
          dispatch(clearProposedTask())
        } else {
          const isIdentical = areStepsIdentical(
            res.response.task,
            taskStructure,
          )

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
    } catch (error) {
      // fetchApi already toasts every failure path (services/api.ts) — a
      // second toast here just stacks a redundant message behind it.
      console.error('Error sending message:', error)
      setMessage(message)
    } finally {
      setIsProcessing(false)
    }
  }

  const renderMessage = (msg: MessageType) => {
    if (msg.user === UserChatEnum.USER) {
      return (
        <UserBubble
          key={msg.id}
          text={msg.text}
          timestamp={msg.timestamp}
          user="User"
          avatarUrl="/pages/user.png"
        />
      )
    } else {
      return (
        <React.Fragment key={msg.id}>
          <AssistantBubble
            text={msg.text}
            timestamp={msg.timestamp}
            avatarUrl="/pages/robot.png"
            parts={msg.parts}
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
        <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
      </div>
    )
  }

  return (
    <Box
      sx={{
        position: 'relative',
        width: chatOpen ? width : 0,
        minWidth: chatOpen ? width : 0,
        order: chatPosition === 'left' ? 1 : 2,
        transition: isResizing
          ? 'none'
          : 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden',
        background: theme.palette.background.paper,
        border: `1px solid ${theme.palette.divider}`,
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
        <div
          onPointerDown={startResizing}
          style={{
            position: 'absolute',
            top: 0,
            left: chatPosition === 'right' ? 0 : 'auto',
            right: chatPosition === 'left' ? 0 : 'auto',
            width: '6px',
            height: '100%',
            cursor: 'col-resize',
            zIndex: 100,
            background: 'transparent',
          }}
          className="resize-handle"
        />
      )}

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div
            style={{
              color: theme.palette.slate[600],
              fontSize: '0.74rem',
              fontWeight: 700,
              letterSpacing: '0.12em',
            }}
          >
            COPILOT
          </div>
          <div
            style={{
              color: theme.palette.slate[400],
              fontSize: '0.63rem',
              fontWeight: 500,
              letterSpacing: '0.02em',
            }}
          >
            Ask for help with your task
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Tooltip
            title={chatPosition === 'left' ? 'Move to right' : 'Move to left'}
            placement="bottom"
          >
            <IconButton
              onClick={() => dispatch(toggleChatPosition())}
              size="small"
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
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {listMessages.map(renderMessage)}
          {isProcessing && renderTypingIndicator()}
          <div ref={chatEndRef} />
        </div>

        {/* Proposal Details Slide-Up Overlay */}
        {proposal.proposedTask && (
          <div
            className={`proposal-overlay ${
              showProposalOverlay ? 'overlay-open' : ''
            }`}
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
                if (onApplyProposedTask && proposal.proposedTask) {
                  onApplyProposedTask(proposal.proposedTask)
                }
                if (onBlocksGenerated && proposal.proposedTask) {
                  const converted = abstractToBlockly(
                    proposal.proposedTask,
                    dataObjects,
                    dataLocations,
                    dataActions,
                  )
                  // Find all generated blocks inside converted state
                  if (converted && Array.isArray(converted.blocks)) {
                    const mappedPayloads = converted.blocks.map((b: any) => ({
                      blockType: b.type,
                      blockXml: b.xml || '',
                    }))
                    onBlocksGenerated(mappedPayloads)
                  }
                }
                dispatch(clearProposedTask())
              }}
              onCancel={() => {
                dispatch(clearProposedTask())
              }}
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
              onClick={() => dispatch(clearProposedTask())}
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
    </Box>
  )
}
