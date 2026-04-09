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
import { blocklyToAbstract, CustomBlock } from 'utils/blocklyParser'

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

const storedUser: unknown = getFromLocalStorage('user')
const username =
  typeof storedUser === 'object' &&
  storedUser !== null &&
  'username' in storedUser &&
  typeof storedUser.username === 'string'
    ? storedUser.username
    : 'User'
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
  const successColor =
    (
      theme.palette.success as typeof theme.palette.success & {
        lighter?: string
      }
    ).lighter || theme.palette.success.light
  const primaryColor =
    (
      theme.palette.primary as typeof theme.palette.primary & {
        lighter?: string
      }
    ).lighter || theme.palette.primary.light
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
    void SpeechRecognition.startListening({
      language: 'en-GB',
      continuous: true,
    })
    setIsRecording(true)
  }

  const stopRecording = () => {
    void SpeechRecognition.stopListening()
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

    void fetchApi<ChatResponse>({
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
          void dispatch(updateTask(newTaskStructure))

          if (res.response?.finished) {
            setIsFinished(true)
            void fetchApi<{ taskCode: unknown }>({
              url: endpoints.chat.saveChatTask,
              method: MethodHTTP.POST,
              body: {
                id: Number(id),
                taskStructure: newTaskStructure,
              },
            }).then((res) => {
              const { taskCode } = res
              const abstractTaskCode = blocklyToAbstract(
                taskCode as CustomBlock,
              )

              void fetchApi({
                url: endpoints.graphic.saveGraphicTask,
                method: MethodHTTP.PUT,
                body: {
                  id: Number(id),
                  taskStructure: abstractTaskCode,
                },
              }).then(() => {
                scrollToBottom()
                setTimeout(() => {
                  void navigate(`/graphic/${id}`)
                  void dispatch(activeItem('definegraphic'))
                }, 5000)
              })
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
  }, [dispatch])

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
            key={msg.id}
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
                    backgroundColor: successColor,
                  }
                : {
                    backgroundColor: primaryColor,
                  }
            }
            notchStyle={
              msg.user === UserChatEnum.ROBOT
                ? {
                    fill: successColor,
                  }
                : {
                    fill: primaryColor,
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
