import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import Cookies from 'js-cookie'

import { SPEECH_LANG, matchVoiceKeyword } from 'constants/recognitionRegistry'
import { endpoints } from 'services/endpoints'
import SpeechRecognition, {
  useSpeechRecognition,
} from 'utils/speechRecognition'

/**
 * useVoiceCommand
 *
 * Browser-side voice recognition for the "Voice command" condition block.
 * Uses the Web Speech API via utils/speechRecognition (same module the
 * chat composer uses). The browser recognises speech locally; we match the
 * transcript against a small bilingual keyword map and POST the normalised
 * command (YES/NO/DONE/PROCEED) to the backend, which caches it for the
 * simulation loop to poll. No audio ever leaves the browser to our server.
 *
 * Recognizer language is SPEECH_LANG (constants/recognitionRegistry), the same
 * constant the chat composer uses — they share one recognition session, so
 * whichever starts last would otherwise decide the language for both.
 *
 * `enabled` must reflect "this specific run/test needs voice right now" —
 * the hook owns start/stop/cleanup entirely, including stopping on unmount,
 * so a caller only ever needs to flip this one boolean.
 */

export type VoiceWord = 'YES' | 'NO' | 'DONE' | 'PROCEED'

const OWNER = 'voice-command-block'

export const useVoiceCommand = (enabled: boolean) => {
  const {
    finalTranscript,
    resetTranscript,
    listening,
    isMicrophoneAvailable,
    browserSupportsSpeechRecognition,
  } = useSpeechRecognition()

  const [word, setWord] = useState<VoiceWord | ''>('')
  const [lastError, setLastError] = useState(false)
  const inFlightRef = useRef(false)

  // Report a matched command word to the backend cache. Returns whether the
  // POST actually succeeded — callers must not surface "recognised" as
  // "delivered" without checking this.
  const report = useCallback(async (voice: VoiceWord): Promise<boolean> => {
    if (inFlightRef.current) return false
    inFlightRef.current = true
    try {
      await axios.post(
        endpoints.vision.voice,
        { voice },
        {
          headers: {
            'X-CSRFToken': Cookies.get('csrftoken') ?? '',
            'Content-Type': 'application/json',
          },
          withCredentials: true,
        },
      )
      return true
    } catch {
      return false
    } finally {
      inFlightRef.current = false
    }
  }, [])

  // Only react to finalised speech — interim hypotheses are still being
  // revised by the recognizer and can flip after a command already fired.
  useEffect(() => {
    if (!enabled || !finalTranscript) return
    const matched = matchVoiceKeyword(finalTranscript) as VoiceWord | null
    if (!matched) return
    resetTranscript() // clear so the same word can be said again later
    void report(matched).then((ok) => {
      setLastError(!ok)
      if (ok) setWord(matched)
    })
  }, [enabled, finalTranscript, report, resetTranscript])

  // Single source of truth for the mic lifecycle: starts when enabled, stops
  // when disabled, and — critically — stops on unmount too (the cleanup
  // function below covers both cases), so navigating away mid-run can't
  // leave the microphone listening forever.
  useEffect(() => {
    if (!enabled) return
    if (!browserSupportsSpeechRecognition) return
    void SpeechRecognition.startListening({
      owner: OWNER,
      continuous: true,
      language: SPEECH_LANG,
    })
    return () => {
      void SpeechRecognition.stopListening(OWNER)
      setWord('')
      setLastError(false)
    }
  }, [enabled, browserSupportsSpeechRecognition])

  return {
    word, // last recognised AND delivered command (YES/NO/DONE/PROCEED) or ''
    active: listening,
    browserSupported: browserSupportsSpeechRecognition,
    micDenied: browserSupportsSpeechRecognition && !isMicrophoneAvailable,
    lastError, // true when a command was recognised but the POST failed
  }
}
