import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { X } from 'lucide-react';
import { UserBubble } from './UserBubble';
import { AssistantBubble } from './AssistantBubble';
import { ChatComposer } from './ChatComposer';
import { TaskPreviewCard } from './TaskPreviewCard';
import { MessageType, UserChatEnum, MessageTypeEnum } from '../pages/multimodal/utils';
import { useDispatch, useSelector } from 'react-redux';
import { setProposedTask, clearProposedTask } from 'store/reducers/proposal';
import { endpoints } from 'services/endpoints';
import { MethodHTTP, fetchApi } from 'services/api';
import dayjs from 'dayjs';
import { formatTimeFrontend } from 'utils/date';
import { CHATGPT_ERROR } from 'pages/multimodal/utils';
import { blocklyToAbstract, CustomBlock } from 'utils/blocklyParser';
import { ChatResponse } from 'pages/multimodal/utils';

const normalizeStep = (step: any): any => {
  if (!step || typeof step !== 'object') return step;
  if (Array.isArray(step)) {
    return step.map(normalizeStep);
  }
  const cleaned: any = {};
  const keys = Object.keys(step).sort();
  for (const key of keys) {
    let val = step[key];
    if (val === null || val === undefined) continue;
    if (Array.isArray(val) && val.length === 0) continue;
    
    // Coerce numeric strings to numbers for IDs and numeric properties
    if ((key.endsWith('Id') || key === 'seconds' || key === 'times') && typeof val === 'string' && /^\d+$/.test(val)) {
      val = Number(val);
    }
    
    cleaned[key] = normalizeStep(val);
  }
  return cleaned;
};

const areStepsIdentical = (a: any, b: any) => {
  return JSON.stringify(normalizeStep(a)) === JSON.stringify(normalizeStep(b));
};

interface ChatDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  speaker: boolean;
  setSpeaker: (speaker: boolean) => void;
  isProcessing: boolean;
  setIsProcessing: (isProcessing: boolean) => void;
  fineTunedModel: string;
  setFineTunedModel: (model: string) => void;
  fineTuningJobId: string;
  setFineTuningJobId: (jobId: string) => void;
  listMessages: MessageType[];
  setListMessages: (messages: MessageType[]) => void;
  chatLog: any[];
  setChatLog: (log: any[]) => void;
  message: string;
  setMessage: (message: string) => void;
  dataObjects: any[];
  dataLocations: any[];
  dataActions: any[];
  isRecording: boolean;
  setIsRecording: (recording: boolean) => void;
  transcript: string;
  resetTranscript: () => void;
  browserSupportsSpeechRecognition: boolean;
  isMicrophoneAvailable: boolean;
  taskId: string;
  taskStructure: any; // TaskChatStructure
  setTaskStructure: (taskStructure: any) => void;
  onApplyProposedTask: (proposedTask: any[]) => void;
  setNewChatResponse: (response: boolean) => void;
}

export const ChatDrawer: React.FC<ChatDrawerProps> = ({
  open,
  onOpenChange,
  speaker,
  setSpeaker,
  isProcessing,
  setIsProcessing,
  fineTunedModel,
  setFineTunedModel,
  fineTuningJobId,
  setFineTuningJobId,
  listMessages,
  setListMessages,
  chatLog,
  setChatLog,
  message,
  setMessage,
  dataObjects,
  dataLocations,
  dataActions,
  isRecording,
  setIsRecording,
  transcript,
  resetTranscript,
  browserSupportsSpeechRecognition,
  isMicrophoneAvailable,
  taskId,
  taskStructure,
  setTaskStructure,
  onApplyProposedTask,
  setNewChatResponse,
}) => {
  const dispatch = useDispatch();
  const proposal = useSelector((state: any) => state.proposal);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [width, setWidth] = React.useState(450);
  const [isResizing, setIsResizing] = React.useState(false);
  const [showProposalOverlay, setShowProposalOverlay] = React.useState(false);

  // Auto-open overlay when a new proposal is received
  const prevProposedTaskRef = useRef<any>(null);
  useEffect(() => {
    if (proposal.proposedTask && !prevProposedTaskRef.current) {
      setShowProposalOverlay(true);
    } else if (!proposal.proposedTask) {
      setShowProposalOverlay(false);
    }
    prevProposedTaskRef.current = proposal.proposedTask;
  }, [proposal.proposedTask]);

  const startResizing = React.useCallback((pointerDownEvent: React.PointerEvent) => {
    pointerDownEvent.preventDefault();
    setIsResizing(true);
    const startWidth = width;
    const startX = pointerDownEvent.clientX;

    const handlePointerMove = (pointerMoveEvent: PointerEvent) => {
      const newWidth = startWidth + (pointerMoveEvent.clientX - startX);
      if (newWidth >= 320 && newWidth <= 750) {
        setWidth(newWidth);
      }
    };

    const handlePointerUp = (pointerUpEvent: PointerEvent) => {
      setIsResizing(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }, [width]);

  // Scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [listMessages]);

  const onMessageSend = async () => {
    if (!message.trim() || isProcessing) return;

    const newUserMessage: MessageType = {
      text: message,
      id: listMessages[listMessages.length - 1].id + 1,
      user: UserChatEnum.USER,
      timestamp: dayjs().toISOString(),
      type: MessageTypeEnum.TEXT,
    };
    const messagesWithUserRequest = [...listMessages, newUserMessage];
    setListMessages(messagesWithUserRequest);
    setIsProcessing(true);
    setMessage('');

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
          taskStructure: taskStructure,
        },
      });

      if (res) {
        if (res.fineTunedModel && res.fineTunedModel !== fineTunedModel) setFineTunedModel(res.fineTunedModel);
        if (res.fineTuningJobId && res.fineTuningJobId !== fineTuningJobId) setFineTuningJobId(res.fineTuningJobId);

        if (speaker) {
          const utterance = new SpeechSynthesisUtterance(res.response.answer);
          utterance.lang = 'en-GB';
          window.speechSynthesis.speak(utterance);
        }

        const newRobotMessage: MessageType = {
          text: res.response.answer || CHATGPT_ERROR,
          id: messagesWithUserRequest[messagesWithUserRequest.length - 1].id + 1,
          user: UserChatEnum.ROBOT,
          timestamp: dayjs().toISOString(),
          type: MessageTypeEnum.TEXT,
        };
        const newMessages: MessageType[] = [newRobotMessage];

        // Always show the robot's message in the chat
        setListMessages([...messagesWithUserRequest, ...newMessages]);
        setChatLog(res.chatLog);

        const taskModified = res.response?.taskModified ?? true;

        if (!taskModified) {
          // If the task was not modified, clear proposed task and do not apply anything to the workspace!
          dispatch(clearProposedTask());
        } else {
          const isIdentical = areStepsIdentical(res.response.task, taskStructure);

          if (isIdentical) {
            // If the task structure didn't change semantically, do not apply and clear proposed task
            dispatch(clearProposedTask());
          } else if (Array.isArray(res.response.task) && res.response.task.length > 0) {
            // Se abbiamo ricevuto un task valido, lo impostiamo come proposta per chiedere la conferma dell'utente!
            dispatch(
              setProposedTask({
                proposedTask: res.response.task,
                validationWarnings: res.response.validationWarnings || [],
                answer: res.response.answer || '',
              })
            );
          } else {
            dispatch(clearProposedTask());
          }
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsProcessing(false);
    }
  };

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
      );
    } else {
      return (
        <AssistantBubble
          key={msg.id}
          text={msg.text}
          timestamp={msg.timestamp}
          avatarUrl="/pages/robot.png"
        />
      );
    }
  };

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
    );
  };

  return (
    <Box
      sx={{
        position: 'relative',
        width: open ? width : 0,
        minWidth: open ? width : 0,
        transition: isResizing ? 'none' : 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden',
        background: 'rgba(246, 248, 251, 0.85)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(99, 102, 241, 0.12)',
        borderRight: '2px solid rgba(99, 102, 241, 0.22)',
        boxShadow: '0 20px 40px -15px rgba(31, 38, 135, 0.06), 0 4px 12px 0 rgba(0, 0, 0, 0.02)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        margin: '0',
        borderRadius: '10px',
        boxSizing: 'border-box',
      }}
    >
      <style>{`
        .resize-handle {
          transition: background 0.15s ease !important;
        }
        .resize-handle:hover, .resize-handle:active {
          background: rgba(99, 102, 241, 0.3) !important;
        }
        .chat-messages-container::-webkit-scrollbar {
          width: 5px !important;
        }
        .chat-messages-container::-webkit-scrollbar-track {
          background: transparent !important;
        }
        .chat-messages-container::-webkit-scrollbar-thumb {
          background: rgba(99, 102, 241, 0.18) !important;
          border-radius: 10px !important;
        }
        .chat-messages-container::-webkit-scrollbar-thumb:hover {
          background: rgba(99, 102, 241, 0.35) !important;
        }
        .close-btn-premium {
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .close-btn-premium:hover {
          transform: rotate(90deg) scale(1.08) !important;
          background: rgba(99, 102, 241, 0.08) !important;
        }
        .close-btn-premium:active {
          transform: rotate(90deg) scale(0.92) !important;
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
          background-color: #10b981;
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

      {open && (
        <div
          onPointerDown={startResizing}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: '6px',
            height: '100%',
            cursor: 'col-resize',
            zIndex: 100,
            background: 'transparent',
            borderTopRightRadius: '20px',
            borderBottomRightRadius: '20px',
          }}
          className="resize-handle"
        />
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 20px',
          borderBottom: '1px solid rgba(99, 102, 241, 0.08)',
          background: 'rgba(238, 242, 246, 0.5)',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: '16px', color: '#1e1b4b', letterSpacing: '-0.02em' }}>
          Interactive Assistant
        </div>
        <button
          onClick={() => onOpenChange(false)}
          className="close-btn-premium"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '8px',
          }}
        >
          <X size={18} style={{ color: '#6366f1' }} />
        </button>
      </div>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Chat message history list */}
        <div
          className="chat-messages-container"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          {listMessages.map(renderMessage)}
          {isProcessing && renderTypingIndicator()}
          <div ref={chatEndRef} />
        </div>

        {/* Slide-Up Details Overlay Panel */}
        {proposal.proposedTask && (
          <div
            className={`proposal-overlay ${showProposalOverlay ? 'overlay-open' : ''}`}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 90,
              background: '#ffffff',
              transform: showProposalOverlay ? 'translateY(0)' : 'translateY(100%)',
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
                onApplyProposedTask(proposal.proposedTask);
                setNewChatResponse(true);
                dispatch(clearProposedTask());
              }}
              onCancel={() => {
                dispatch(clearProposedTask());
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
              background: #6366f1;
              color: white;
              border: none;
              padding: 4px 10px;
              border-radius: 6px;
              font-size: 12px;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.2s;
            }
            .badge-action-btn:hover {
              background: #4f46e5;
              transform: scale(1.03);
            }
            .badge-action-btn:active {
              transform: scale(0.96);
            }
          `}</style>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              width: '6px',
              height: '6px',
              backgroundColor: '#6366f1',
              borderRadius: '50%',
              display: 'inline-block',
              boxShadow: '0 0 8px #6366f1'
            }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e1b4b' }}>
              New Blockly task proposed
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={() => setShowProposalOverlay(true)}
              className="badge-action-btn"
            >
              View Details
            </button>
            <button
              onClick={() => dispatch(clearProposedTask())}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
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
  );
};