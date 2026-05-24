import React, { useEffect, useRef } from 'react';
import { Card } from 'antd';
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
    const val = step[key];
    if (val === null || val === undefined) continue;
    if (Array.isArray(val) && val.length === 0) continue;
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

        const isIdentical = areStepsIdentical(res.response.task, taskStructure);

        if (isIdentical) {
          // If the task structure didn't change semantically, do not apply and clear proposed task
          dispatch(clearProposedTask());
        } else if (Array.isArray(res.response.task) && res.response.task.length > 0) {
          // If we received a valid multimodal task array, automatically apply it to the workspace!
          onApplyProposedTask(res.response.task);
          setNewChatResponse(true);
          dispatch(clearProposedTask());
        } else if (res.response?.finished) {
          // Fallback legacy flow: if finished is true, save the chat task structure
          await fetchApi({
            url: endpoints.chat.saveChatTask,
            method: MethodHTTP.POST,
            body: {
              id: Number(taskId),
              taskStructure: res.response.task || taskStructure,
            },
          }).then((saveRes) => {
            const { taskCode } = saveRes as { taskCode: unknown };
            const abstractTaskCode = blocklyToAbstract(taskCode as CustomBlock);

            void fetchApi({
              url: endpoints.graphic.saveGraphicTask,
              method: MethodHTTP.PUT,
              body: {
                id: Number(taskId),
                taskStructure: abstractTaskCode,
              },
            }).then(() => {
              // Finish action
            });
          });
          dispatch(clearProposedTask());
        } else if (res.response.task) {
          // Legacy flow: not finished yet, dispatch proposed task to show preview card
          dispatch(
            setProposedTask({
              proposedTask: res.response.task || null,
              validationWarnings: res.response.validationWarnings || [],
              answer: res.response.answer || '',
            })
          );
        } else {
          dispatch(clearProposedTask());
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

  return (
    <Card
      bordered={false}
      style={{
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
      }}
      styles={{
        body: {
          padding: 0,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
        }
      }}
    >
      <style>{`
        .resize-handle {
          transition: background 0.15s ease !important;
        }
        .resize-handle:hover, .resize-handle:active {
          background: rgba(99, 102, 241, 0.3) !important;
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
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '8px',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0, 0, 0, 0.05)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
        >
          <X size={18} style={{ color: '#6366f1' }} />
        </button>
      </div>

      <div
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
        <div ref={chatEndRef} />
      </div>

      {proposal.proposedTask && (
        <div
          style={{
            borderTop: '1px solid rgba(0, 0, 0, 0.05)',
            background: 'rgba(255, 255, 255, 0.4)',
            maxHeight: '50%',
            overflowY: 'auto',
            flexShrink: 0,
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
          />
        </div>
      )}

      <ChatComposer
        taskId={taskId}
        taskStructure={taskStructure}
        setTaskStructure={setTaskStructure}
        speaker={speaker}
        setSpeaker={setSpeaker}
        isProcessing={isProcessing}
        setIsProcessing={setIsProcessing}
        fineTunedModel={fineTunedModel}
        setFineTunedModel={setFineTunedModel}
        fineTuningJobId={fineTuningJobId}
        setFineTuningJobId={setFineTuningJobId}
        listMessages={listMessages}
        setListMessages={setListMessages}
        chatLog={chatLog}
        setChatLog={setChatLog}
        message={message}
        setMessage={setMessage}
        dataObjects={dataObjects}
        dataLocations={dataLocations}
        dataActions={dataActions}
        isRecording={isRecording}
        setIsRecording={setIsRecording}
        transcript={transcript}
        resetTranscript={resetTranscript}
        browserSupportsSpeechRecognition={browserSupportsSpeechRecognition}
        isMicrophoneAvailable={isMicrophoneAvailable}
      />
    </Card>
  );
};