import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { SystemMessage } from 'react-chat-elements'
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
  timestamp: formatTimeFrontend(dayjs().toString()),
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
  task: AbstractStep[]
}

export interface ChatResponse {
  chatLog: ChatLogType[]
  response: ResponseChatGPT
  fineTunedModel: string
  fineTuningJobId: string
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
  const [typingText, setTypingText] = useState('Robot is typing')
  const [dotsCount, setDotsCount] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setDotsCount((prevCount) => (prevCount + 1) % 4)
    }, 500)

    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    setTypingText(`Robot is typing${'.'.repeat(dotsCount)}`)
  }, [dotsCount])

  return (
    <SystemMessage
      text={typingText}
      id={-3}
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
      className="msg-is-typing"
    />
  )
}
