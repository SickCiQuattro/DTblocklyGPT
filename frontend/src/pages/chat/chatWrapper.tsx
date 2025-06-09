import React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  IconButton,
  InputAdornment,
  OutlinedInput,
  useTheme,
} from '@mui/material'
import dayjs from 'dayjs'
import { AudioOutlined, BorderOutlined, SendOutlined } from '@ant-design/icons'
import { MessageBox } from 'react-chat-elements'
import SpeechRecognition, {
  useSpeechRecognition,
} from 'react-speech-recognition'
import { useDispatch } from 'react-redux'

import { formatTimeFrontend } from 'utils/date'
import { getFromLocalStorage } from 'utils/localStorageUtils'
import 'react-chat-elements/dist/main.css'
import './customStyle.css'
import { MethodHTTP, fetchApi } from 'services/api'
import { endpoints } from 'services/endpoints'
import { activeItem, openDrawer } from 'store/reducers/menu'
import { resetTask, updateTask } from 'store/reducers/task'
import {
  CHATGPT_ERROR,
  ChatLogType,
  ChatResponse,
  FINE_TUNED_MODEL,
  FINE_TUNING_JOB_ID,
  INITIAL_MESSAGE_1,
  LastMessage,
  MergeTaskStructure,
  MessageType,
  MessageTypeEnum,
  TaskChatStructure,
  TypingSystemMessage,
  UserChatEnum,
} from './utils'

const { username } = getFromLocalStorage('user')
const scrollToBottom = () => {
  const chatContainer = document.getElementById('chatContainer')
  if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight
}

interface ChatWrapperProps {
  speaker: boolean
  taskStructure: TaskChatStructure
  setTaskStructure: (taskStructure: TaskChatStructure) => void
}

export const ChatWrapper = ({
  speaker,
  taskStructure,
  setTaskStructure,
}: ChatWrapperProps) => {
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const theme = useTheme()
  const [fineTunedModel, setFineTunedModel] = React.useState(FINE_TUNED_MODEL)
  const [fineTuningJobId, setFineTuningJobId] =
    React.useState(FINE_TUNING_JOB_ID)
  const [listMessages, setListMessages] = React.useState<MessageType[]>([
    INITIAL_MESSAGE_1,
  ])
  const [chatLog, setChatLog] = React.useState<ChatLogType[]>([])
  const [message, setMessage] = React.useState('')
  const [isProcessing, setIsProcessing] = React.useState(false)
  const [isRecording, setIsRecording] = React.useState(false)
  const [isFinished, setIsFinished] = React.useState(false)
  const {
    transcript,
    resetTranscript,
    browserSupportsSpeechRecognition,
    isMicrophoneAvailable,
  } = useSpeechRecognition()

  const startRecording = () => {
    SpeechRecognition.startListening({ language: 'en-GB', continuous: true })
    setIsRecording(true)
  }

  const stopRecording = () => {
    SpeechRecognition.stopListening()
    setMessage(transcript)
    resetTranscript()
    setIsRecording(false)
  }

  const onMessageSend = () => {
    const messagesWithUserRequest = [
      ...listMessages,
      {
        text: message,
        id: listMessages[listMessages.length - 1].id + 1,
        user: UserChatEnum.USER,
        timestamp: formatTimeFrontend(dayjs().toString()),
        type: MessageTypeEnum.TEXT,
      },
    ]
    setListMessages(messagesWithUserRequest)
    setIsProcessing(true)
    setMessage('')

    fetchApi({
      url: endpoints.chat.newMessage,
      method: MethodHTTP.POST,
      body: {
        id: Number(id),
        message,
        chatLog,
        fineTunedModel,
        fineTuningJobId,
      },
    })
      .then((res: ChatResponse) => {
        if (res) {
          if (res.fineTunedModel !== fineTunedModel)
            setFineTunedModel(res.fineTunedModel)
          if (res.fineTuningJobId !== fineTuningJobId)
            setFineTuningJobId(res.fineTuningJobId)

          if (speaker) {
            const utterance = new SpeechSynthesisUtterance(res.response.answer)
            utterance.lang = 'en-GB'
            window.speechSynthesis.speak(utterance)
          }

          const newMessage: MessageType = {
            text: res.response.answer || CHATGPT_ERROR,
            id:
              messagesWithUserRequest[messagesWithUserRequest.length - 1].id +
              1,
            user: UserChatEnum.ROBOT,
            timestamp: formatTimeFrontend(dayjs().toString()),
            type: MessageTypeEnum.TEXT,
          }
          const newMessages: MessageType[] = [newMessage]

          if (!res.response?.finished) {
            setListMessages([...messagesWithUserRequest, ...newMessages])
            setChatLog(res.chatLog)
          }

          const newTaskStructure: TaskChatStructure = MergeTaskStructure(
            taskStructure,
            res.response.task,
          )
          setTaskStructure(newTaskStructure)
          dispatch(updateTask(newTaskStructure))

          if (res.response?.finished) {
            setIsFinished(true)
            fetchApi({
              url: endpoints.chat.saveChatTask,
              method: MethodHTTP.POST,
              body: {
                id: Number(id),
                taskStructure: newTaskStructure,
              },
            }).then(() => {
              scrollToBottom()
              setTimeout(() => {
                navigate(`/graphic/${id}`)
                dispatch(activeItem('definegraphic'))
              }, 5000)
            })
          }
        }
      })
      .finally(() => {
        setIsProcessing(false)
      })
  }

  React.useEffect(() => {
    scrollToBottom()
  }, [listMessages])

  React.useEffect(() => {
    dispatch(openDrawer(false))
    dispatch(resetTask())
  }, [])

  return (
    <div
      style={{
        position: 'relative',
        width: '66.66%',
        marginRight: '1rem',
      }}
    >
      <div style={{ overflow: 'auto', height: '90%' }} id="chatContainer">
        {listMessages.map((msg) => (
          <MessageBox
            position={msg.user === UserChatEnum.ROBOT ? 'left' : 'right'}
            title={msg.user === UserChatEnum.ROBOT ? 'Robot' : username}
            type={msg.type}
            text={msg.text}
            {...(msg.uri && msg.type === MessageTypeEnum.PHOTO
              ? {
                  data: {
                    uri: msg.uri,
                    alt: msg.text,
                    width: 200,
                    height: 200,
                    status: {
                      download: true,
                    },
                  },
                }
              : {})}
            date={new Date()}
            dateString={msg.timestamp || ''}
            id={msg.id}
            key={msg.id}
            focus={false}
            titleColor={
              msg.user === UserChatEnum.ROBOT
                ? theme.palette.success.main
                : theme.palette.primary.main
            }
            forwarded={false}
            replyButton={false}
            removeButton={false}
            notch
            retracted={false}
            status="sent"
            avatar={
              msg.user === UserChatEnum.ROBOT
                ? '/pages/robot.png'
                : '/pages/user.png'
            }
            styles={
              msg.user === UserChatEnum.ROBOT
                ? {
                    backgroundColor: (theme.palette.success as any).lighter,
                  }
                : {
                    backgroundColor: (theme.palette.primary as any).lighter,
                  }
            }
            notchStyle={
              msg.user === UserChatEnum.ROBOT
                ? {
                    fill: (theme.palette.success as any).lighter,
                  }
                : {
                    fill: (theme.palette.primary as any).lighter,
                  }
            }
          />
        ))}
        {isProcessing && <TypingSystemMessage />}
        {isFinished && (
          <LastMessage id={listMessages[listMessages.length - 1].id + 1} />
        )}
      </div>
      <OutlinedInput
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={isRecording ? 'Listening...' : 'Type a message...'}
        disabled={isRecording}
        autoFocus
        fullWidth
        style={{
          position: 'absolute',
          bottom: 0,
          marginTop: '1rem',
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isProcessing) onMessageSend()
        }}
        endAdornment={
          <>
            {message && (
              <InputAdornment position="end">
                <IconButton
                  onClick={() => onMessageSend()}
                  edge="end"
                  disabled={isProcessing}
                >
                  <SendOutlined />
                </IconButton>
              </InputAdornment>
            )}
            {!message && !isRecording && (
              <InputAdornment position="end">
                <IconButton
                  onClick={() => startRecording()}
                  edge="end"
                  disabled={
                    isProcessing ||
                    !browserSupportsSpeechRecognition ||
                    !isMicrophoneAvailable
                  }
                >
                  <AudioOutlined />
                </IconButton>
              </InputAdornment>
            )}
            {!message && isRecording && (
              <InputAdornment position="end">
                <IconButton
                  onClick={() => stopRecording()}
                  edge="end"
                  disabled={
                    isProcessing ||
                    !browserSupportsSpeechRecognition ||
                    !isMicrophoneAvailable
                  }
                >
                  <BorderOutlined />
                </IconButton>
              </InputAdornment>
            )}
          </>
        }
      />
    </div>
  )
}
