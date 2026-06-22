import dayjs from 'dayjs'

import { AbstractStep } from 'pages/tasks/types'

export enum UserChatEnum {
  USER = 'user',
  ROBOT = 'robot',
}

export enum MessageTypeEnum {
  TEXT = 'text',
  PHOTO = 'photo',
}

export type ChatIntent = 'explain' | 'analyze' | 'modify' | 'evaluate'

export type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'suggestion'; content: string }
  | { type: 'warning'; content: string }

export interface MessageType {
  id: number
  text: string
  user: UserChatEnum
  timestamp: string | null
  type: MessageTypeEnum
  uri?: string
  /** Typed extras shown below the text bubble (suggestions, warnings). */
  parts?: MessagePart[]
  /** What the assistant did this turn — drives the evaluation card. */
  intent?: ChatIntent
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
  intent?: ChatIntent
  /** BCP-47 language of the answer, used to pick the TTS voice. */
  lang?: string
  finished?: boolean
  validationWarnings?: string[]
}

export interface ChatResponse {
  chatLog: ChatLogType[]
  response: ResponseChatGPT
  messageParts?: MessagePart[]
  intent?: ChatIntent
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
