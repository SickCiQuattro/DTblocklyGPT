import { useSyncExternalStore } from 'react'

/**
 * Thin wrapper over the browser's native Web Speech API, exposing the same
 * surface we used from `react-speech-recognition` (default controller +
 * `useSpeechRecognition` hook) so consumers only swap the import path.
 *
 * The recognition instance and its state live at module level: the browser
 * allows a single active SpeechRecognition session, and all consumers
 * (chat composer, voice-command block) must observe the same transcript —
 * exactly the singleton behaviour the old library provided. Components
 * subscribe via useSyncExternalStore.
 *
 * Chrome-only in practice: Firefox/Safari lack SpeechRecognition, in which
 * case `browserSupportsSpeechRecognition` is false and the mic UI is
 * disabled (same behaviour as before the migration).
 */

interface SpeechRecognitionResultAlternativeLike {
  transcript: string
}

interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: SpeechRecognitionResultAlternativeLike
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: {
    length: number
    [index: number]: SpeechRecognitionResultLike
  }
}

interface SpeechRecognitionErrorEventLike {
  error: string
}

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
}

const RecognitionCtor: SpeechRecognitionCtor | undefined =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : undefined

const browserSupportsSpeechRecognition = Boolean(RecognitionCtor)

interface SpeechState {
  transcript: string
  finalTranscript: string
  listening: boolean
  isMicrophoneAvailable: boolean
}

let state: SpeechState = {
  transcript: '',
  finalTranscript: '',
  listening: false,
  isMicrophoneAvailable: true,
}
const subscribers = new Set<() => void>()

const setState = (patch: Partial<SpeechState>) => {
  state = { ...state, ...patch }
  subscribers.forEach((notify) => notify())
}

// App-level intent, distinct from the session actually running: Chrome kills
// continuous sessions after prolonged silence, and onend uses this flag to
// know whether to transparently restart or to report "stopped". Tracked as a
// set of owner ids (not a boolean) because independent consumers share this
// one singleton (chat dictation + the voice-command block) — one owner
// stopping must not kill the session another owner still needs.
const listenRequests = new Set<string>()
let finalTranscript = ''

// ponytail: unbounded restart would spin forever against a dead mic
// (audio-capture / repeated network errors fire error->end immediately).
// Cap attempts; reset the counter on any real result, which proves the
// recognizer is actually healthy.
let restartAttempts = 0
const MAX_RESTART_ATTEMPTS = 5

let recognition: SpeechRecognitionLike | null = null

const getRecognition = (): SpeechRecognitionLike | null => {
  if (!RecognitionCtor) return null
  if (recognition) return recognition

  recognition = new RecognitionCtor()
  recognition.interimResults = true

  recognition.onresult = (event) => {
    restartAttempts = 0 // real speech came through — recognizer is healthy
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i]
      const text = result[0].transcript
      if (result.isFinal) {
        finalTranscript = [finalTranscript, text.trim()]
          .filter(Boolean)
          .join(' ')
      } else {
        interim += text
      }
    }
    setState({
      transcript: [finalTranscript, interim.trim()].filter(Boolean).join(' '),
      finalTranscript,
    })
  }

  recognition.onerror = (event) => {
    if (
      event.error === 'not-allowed' ||
      event.error === 'service-not-allowed'
    ) {
      listenRequests.clear()
      setState({ isMicrophoneAvailable: false, listening: false })
    }
  }

  recognition.onend = () => {
    if (listenRequests.size > 0 && recognition) {
      if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
        // ponytail: give up instead of spinning forever on a dead mic —
        // listenRequests stays populated so a caller can tell the
        // difference from a clean stop, but we no longer retry it.
        setState({ listening: false })
        return
      }
      restartAttempts += 1
      try {
        recognition.start()
      } catch {
        setState({ listening: false })
      }
    } else {
      setState({ listening: false })
    }
  }

  return recognition
}

interface StartListeningOptions {
  /** Identifies the caller so stopListening from a different owner can't
   * kill a session another owner still needs (chat dictation vs the
   * voice-command block share this one singleton). */
  owner: string
  continuous?: boolean
  language?: string
}

const SpeechRecognitionController = {
  startListening: ({
    owner,
    continuous = false,
    language,
  }: StartListeningOptions) => {
    const rec = getRecognition()
    if (!rec) return
    rec.continuous = continuous
    rec.lang = language || navigator.language || 'en-US'
    listenRequests.add(owner)
    restartAttempts = 0
    try {
      rec.start()
    } catch {
      // start() throws if a session is already running — keep it going
    }
    setState({ listening: true, isMicrophoneAvailable: true })
  },

  stopListening: (owner: string) => {
    listenRequests.delete(owner)
    if (listenRequests.size > 0) return // another owner still needs the mic
    recognition?.stop()
    setState({ listening: false })
  },
}

const resetTranscript = () => {
  finalTranscript = ''
  setState({ transcript: '', finalTranscript: '' })
}

const subscribe = (notify: () => void) => {
  subscribers.add(notify)
  return () => {
    subscribers.delete(notify)
  }
}

const getSnapshot = () => state

export const useSpeechRecognition = () => {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)
  return {
    transcript: snapshot.transcript,
    finalTranscript: snapshot.finalTranscript,
    listening: snapshot.listening,
    isMicrophoneAvailable: snapshot.isMicrophoneAvailable,
    browserSupportsSpeechRecognition,
    resetTranscript,
  }
}

export default SpeechRecognitionController
