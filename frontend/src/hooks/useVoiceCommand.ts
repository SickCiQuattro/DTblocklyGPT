import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import Cookies from 'js-cookie'

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
 * English is primary (recognizer lang 'en-US'); a few Italian synonyms are
 * matched best-effort as a bonus.
 */

export type VoiceWord = 'YES' | 'NO' | 'DONE' | 'PROCEED'

// command → spoken synonyms (lowercase). English first, Italian as a bonus.
const VOICE_KEYWORDS: Record<VoiceWord, string[]> = {
  YES: ['yes', 'yeah', 'yep', 'si', 'sì'],
  NO: ['no', 'nope'],
  DONE: ['done', 'finished', 'complete', 'fatto', 'completato'],
  PROCEED: ['proceed', 'go', 'next', 'continue', 'procedi', 'vai', 'avanti'],
}

/** Return the first command whose synonym appears as a word in the transcript. */
const matchVoiceKeyword = (transcript: string): VoiceWord | null => {
  const words = transcript.toLowerCase().split(/\s+/)
  for (const cmd of Object.keys(VOICE_KEYWORDS) as VoiceWord[]) {
    if (VOICE_KEYWORDS[cmd].some((syn) => words.includes(syn))) {
      return cmd
    }
  }
  return null
}

export const useVoiceCommand = () => {
  const {
    transcript,
    resetTranscript,
    listening,
    browserSupportsSpeechRecognition,
  } = useSpeechRecognition()

  const [word, setWord] = useState<VoiceWord | ''>('')
  const inFlightRef = useRef(false)

  // Report a matched command word to the backend cache.
  const report = useCallback(async (voice: VoiceWord) => {
    if (inFlightRef.current) return
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
    } catch {
      // ignore transient errors
    } finally {
      inFlightRef.current = false
    }
  }, [])

  // Watch the transcript and fire on the first matched keyword.
  useEffect(() => {
    if (!transcript) return
    const matched = matchVoiceKeyword(transcript)
    if (matched) {
      setWord(matched)
      void report(matched)
      resetTranscript() // clear so the same word can be said again later
    }
  }, [transcript, report, resetTranscript])

  const start = useCallback(() => {
    if (!browserSupportsSpeechRecognition) return
    void SpeechRecognition.startListening({
      continuous: true,
      language: 'en-US',
    })
  }, [browserSupportsSpeechRecognition])

  const stop = useCallback(() => {
    void SpeechRecognition.stopListening()
    setWord('')
  }, [])

  return {
    word, // last recognised command (YES/NO/DONE/PROCEED) or ''
    active: listening,
    browserSupported: browserSupportsSpeechRecognition,
    start,
    stop,
  }
}
