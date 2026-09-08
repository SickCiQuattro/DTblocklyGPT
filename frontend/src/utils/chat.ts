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

// The example names things that are ACTUALLY in the library.
//
// It used to read "pick up the flask and place it in the rack". There is no
// flask in the catalogue — the objects are tubes and a medicine bottle — and
// the destination is "tube rack", not "rack". So the first sentence a
// first-time operator reads is an instruction that does not work: type it
// verbatim and the assistant either reports that the object does not exist or
// invents one. That is a bad first turn anywhere, and worse in a study where a
// task is deliberately chat-only, because the failure looks like the operator's.
//
// "blue tube" and "sample tray" are seeded by seed_library.py and are the
// names the operator will see in the Library. Keep them in step with that
// command: an example is only useful while its nouns resolve.
export const INITIAL_MESSAGE_1: MessageType = {
  id: 0,
  text: 'Tell me what the robot should do — e.g. "pick up the blue tube and place it on the sample tray" — and I\'ll build the blocks for you.',
  user: UserChatEnum.ROBOT,
  // null, not dayjs() — this is a module-level const evaluated once at import
  // time, so a fixed timestamp would freeze at app-start time forever.
  // AssistantBubble already falls back to the render-time clock when null.
  timestamp: null,
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
