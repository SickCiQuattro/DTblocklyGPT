import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { SystemMessage, MessageBox } from 'react-chat-elements'
import { useTheme } from '@mui/material'

import { formatTimeFrontend } from 'utils/date'
import { AbstractStep } from 'pages/tasks/types'

export enum UserChatEnum {
  USER = 'user',
  ROBOT = 'robot',
}

export enum MessageTypeEnum {
  TEXT = 'text',
  PHOTO = 'photo',
}

export interface MessageType {
  id: number
  text: string
  user: UserChatEnum
  timestamp: string | null
  type: MessageTypeEnum
  uri?: string
}

export const INITIAL_MESSAGE_1: MessageType = {
  id: 0,
  text: 'Hello! I will assist you with your task',
  user: UserChatEnum.ROBOT,
  timestamp: dayjs().toISOString(),
  type: MessageTypeEnum.TEXT,
}

export const CHATGPT_ERROR =
  'A problem occurred while creating the new message. Please try again.'

export interface ChatLogType {
  role: string
  content: string
}

interface ResponseChatGPT {
  answer: string
  task: AbstractStep[] | null
  taskModified?: boolean
  finished?: boolean
  validationWarnings?: string[]
}

export interface ChatResponse {
  chatLog: ChatLogType[]
  response: ResponseChatGPT
  fineTunedModel?: string
  fineTuningJobId?: string
}

export const InitialSystemMessage = () => {
  return (
    <SystemMessage
      text="Start of conversation"
      id={-1}
      position="center"
      type="text"
      title="System message"
      focus={false}
      date={dayjs().toDate()}
      forwarded={false}
      titleColor="black"
      replyButton={false}
      removeButton={false}
      retracted={false}
      status="sent"
      notch={false}
    />
  )
}

export const TypingSystemMessage = () => {
  const theme = useTheme()
  const successColor =
    (
      theme.palette.success as typeof theme.palette.success & {
        lighter?: string
      }
    ).lighter || theme.palette.success.light
  const [messageDate] = useState(() => dayjs().toDate())
  const [dotsCount, setDotsCount] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setDotsCount((prevCount) => (prevCount + 1) % 4)
    }, 500)

    return () => clearInterval(interval)
  }, [])

  const typingText = `Robot is typing${'.'.repeat(dotsCount)}`

  return (
    <MessageBox
      position="left"
      title="Robot"
      type="text"
      text={typingText}
      date={messageDate}
      dateString={formatTimeFrontend(dayjs().toString()) || ''}
      id={-3}
      focus={false}
      titleColor={theme.palette.success.main}
      forwarded={false}
      replyButton={false}
      removeButton={false}
      notch
      retracted={false}
      status="sent"
      avatar="/pages/robot.png"
      styles={{
        backgroundColor: successColor,
      }}
      notchStyle={{
        fill: successColor,
      }}
    />
  )
}
