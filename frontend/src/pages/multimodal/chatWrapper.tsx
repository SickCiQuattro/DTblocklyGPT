import React from 'react'
import { useParams } from 'react-router-dom'
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
import { openDrawer } from 'store/reducers/menu'
import {
  CHATGPT_ERROR,
  ChatLogType,
  ChatResponse,
  INITIAL_MESSAGE_1,
  MessageType,
  MessageTypeEnum,
  TypingSystemMessage,
  UserChatEnum,
} from './utils'
import { AbstractStep } from 'pages/tasks/types'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { ActionListType } from 'pages/actions/types'

const { username } = getFromLocalStorage('user')
const scrollToBottom = () => {
  const chatContainer = document.getElementById('chatContainer')
  if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight
}

interface ChatWrapperProps {
  speaker: boolean
  taskStructure: AbstractStep[]
  setTaskStructure: (taskStructure: AbstractStep[]) => void
  editingMode: boolean
  dataLocations: LocationListType[]
  dataObjects: ObjectListType[]
  dataActions: ActionListType[]
  setNewChatResponse: (response: boolean) => void
}

export const ChatWrapper = ({
  speaker,
  taskStructure,
  setTaskStructure,
  editingMode,
  dataLocations,
  dataObjects,
  dataActions,
  setNewChatResponse,
}: ChatWrapperProps) => {
  const { id } = useParams()
  const dispatch = useDispatch()
  const theme = useTheme()
  const [listMessages, setListMessages] = React.useState<MessageType[]>([
    INITIAL_MESSAGE_1,
  ])
  const [chatLog, setChatLog] = React.useState<ChatLogType[]>([])
  const [message, setMessage] = React.useState('')
  const [isProcessing, setIsProcessing] = React.useState(false)
  const [isRecording, setIsRecording] = React.useState(false)
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
      url: endpoints.chat.newMessageMultimodal,
      method: MethodHTTP.POST,
      body: {
        id: Number(id),
        message,
        chatLog,
        taskStructure,
        dataLocations,
        dataObjects,
        dataActions,
      },
    })
      .then((res: ChatResponse) => {
        if (res) {
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

          setListMessages([...messagesWithUserRequest, ...newMessages])
          setChatLog(res.chatLog)

          setTaskStructure(res.response.task)
          setNewChatResponse(true)
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
  }, [])

  return (
    <div
      style={{
        position: 'relative',
        width: '66.66%',
        marginRight: '1rem',
        marginLeft: '1rem',
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
      </div>
      <OutlinedInput
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={
          isRecording
            ? 'Listening...'
            : !editingMode
              ? 'Enable editing mode'
              : 'Type a message...'
        }
        disabled={isRecording || !editingMode}
        autoFocus
        multiline
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
                    !isMicrophoneAvailable ||
                    !editingMode
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
