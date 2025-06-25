import React, { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { SystemMessage, MessageBox } from 'react-chat-elements'
import { formatTimeFrontend } from 'utils/date'
import { useTheme } from '@mui/material'

export const FINE_TUNED_MODEL = 'AAA'
export const FINE_TUNING_JOB_ID = 'BBB'

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
  text: 'Hello! I will help you with the creation of a new task.',
  user: UserChatEnum.ROBOT,
  timestamp: formatTimeFrontend(dayjs().toString()),
  type: MessageTypeEnum.TEXT,
}

export const CHATGPT_ERROR =
  'A problem occurred while creating the new message. Please try again.'

export const LastMessage = ({ id }: { id: number }) => {
  const theme = useTheme()

  return (
    <MessageBox
      position="left"
      title="Robot"
      type="text"
      text="Task defined! I will be redirect to the graphic interface."
      date={new Date()}
      dateString={formatTimeFrontend(dayjs().toString()) || ''}
      id={id}
      key={id}
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
        backgroundColor: (theme.palette.success as any).lighter,
      }}
      notchStyle={{
        fill: (theme.palette.success as any).lighter,
      }}
    />
  )
}

export interface ChatLogType {
  role: string
  content: string
}

export interface TaskChatStructure {
  program: {
    control: {
      control_type: string | null
      times: number | null
      event: {
        event_type: string | null
        find_object: string | null
      }
      otherwise: {
        otherwise_pick: {
          object: string | null
        }
        otherwise_processing: {
          action: string | null
        }
        otherwise_place: {
          location: string | null
        }
      }
      control_pick: {
        object: string | null
      }
      control_processing: {
        action: string | null
      }
      control_place: {
        location: string | null
      }
    }
    pick: {
      object: string | null
    }
    processing: {
      action: string | null
    }
    place: {
      location: string | null
    }
  }
}

export const INITIAL_TASK_STRUCTURE: TaskChatStructure = {
  program: {
    control: {
      control_type: null,
      times: null,
      event: {
        event_type: null,
        find_object: null,
      },
      otherwise: {
        otherwise_pick: {
          object: null,
        },
        otherwise_processing: {
          action: null,
        },
        otherwise_place: {
          location: null,
        },
      },
      control_pick: {
        object: null,
      },
      control_processing: {
        action: null,
      },
      control_place: {
        location: null,
      },
    },
    pick: {
      object: null,
    },
    processing: {
      action: null,
    },
    place: {
      location: null,
    },
  },
}

interface ResponseChatGPT {
  answer: string
  task: TaskChatStructure
  finished: boolean
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

export const FinishedSystemMessage = () => {
  return (
    <SystemMessage
      text="End of conversation"
      id={-2}
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

export const MergeTaskStructure = (
  oldTaskStructure: TaskChatStructure,
  newTaskStructure: TaskChatStructure,
): TaskChatStructure => {
  const newControlType =
    newTaskStructure.program.control?.control_type ||
    oldTaskStructure.program.control?.control_type

  return {
    program: {
      ...newTaskStructure.program,
      control: {
        ...newTaskStructure.program.control,
        control_type: newControlType,
      },
    },
  }
}
