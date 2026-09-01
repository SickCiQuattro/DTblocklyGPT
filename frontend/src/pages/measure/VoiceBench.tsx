/**
 * VoiceBench — controlled accuracy measurement for the voice channel.
 *
 * Why this is a page and not a script: recognition happens in the browser,
 * against Google's Web Speech service. The Django process never sees audio, so
 * there is no Python equivalent of testing/measure_gesture_accuracy.py for this
 * channel — a bench has to run here or it measures nothing real.
 *
 * Fidelity is the whole point, so this drives the PRODUCTION path: the shared
 * `speechRecognition` singleton with continuous:true and SPEECH_LANG, and
 * `matchVoiceKeyword` imported from the registry rather than reimplemented. A
 * bench with its own recognizer or its own matcher would report the accuracy of
 * something no operator ever uses.
 *
 * What it deliberately does NOT include: the POST to /api/vision/voice and the
 * Django-side cache. Those are ordinary HTTP and are not part of recognition
 * accuracy; folding them in would mix a network failure into a speech number.
 *
 * Not linked from the navigation — reach it at /measure/voice. It is a
 * measurement instrument, not a product surface.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Button, Stack, TextField, Typography } from '@mui/material'

import {
  RECOGNIZED_VOICE_COMMANDS,
  SPEECH_LANG,
  matchVoiceKeyword,
  spokenExample,
} from 'constants/recognitionRegistry'
import SpeechRecognition, {
  useSpeechRecognition,
} from 'utils/speechRecognition'

const OWNER = 'voice-bench'

/**
 * The silence class. Windows expecting this ask the operator to say nothing,
 * and ANY recognised command inside one is a false positive.
 *
 * This is the measurement that matters most and the one a "say each word once"
 * protocol cannot produce. A spurious PROCEED resolves a waiting step before
 * the operator has done anything: the robot moves on by itself, which is worse
 * for them than a word that simply is not heard, and invisible in a
 * per-command accuracy figure.
 */
const SILENCE = 'SILENCE'

interface WindowResult {
  expected: string
  /** Every command the matcher produced inside the window, in order. */
  observations: string[]
  /** Raw recognizer output, so an unmatched utterance stays diagnosable. */
  transcript: string
  /** Seconds from window start to the first command of any kind. */
  onsetAnyS: number | null
  /** Seconds to the first command equal to `expected`. */
  onsetCorrectS: number | null
}

/** Fisher-Yates on a seeded LCG — a fixed seed makes a session repeatable. */
const shuffled = <T,>(items: T[], seed: number): T[] => {
  const out = [...items]
  let s = seed >>> 0 || 1
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1664525 + 1013904223) >>> 0
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const VoiceBench: React.FC = () => {
  const {
    finalTranscript,
    resetTranscript,
    listening,
    browserSupportsSpeechRecognition,
  } = useSpeechRecognition()

  const [operator, setOperator] = useState('')
  const [trials, setTrials] = useState(30)
  const [holdS, setHoldS] = useState(5)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9))

  const [plan, setPlan] = useState<string[]>([])
  const [index, setIndex] = useState(-1)
  const [phase, setPhase] = useState<'idle' | 'ready' | 'recording' | 'done'>(
    'idle',
  )
  const [results, setResults] = useState<WindowResult[]>([])

  // Window-local accumulators. Refs, not state: the recognizer fires several
  // times per window and a re-render per event would reset nothing but would
  // make the ordering of observations depend on React's batching.
  const windowStartRef = useRef(0)
  const observationsRef = useRef<string[]>([])
  const onsetAnyRef = useRef<number | null>(null)
  const onsetCorrectRef = useRef<number | null>(null)
  const seenTranscriptRef = useRef('')

  const classes = useMemo(
    () => [...RECOGNIZED_VOICE_COMMANDS.map((v) => v.code), SILENCE],
    [],
  )

  const startProtocol = useCallback(() => {
    const windows: string[] = []
    classes.forEach((c) => {
      for (let i = 0; i < trials; i += 1) windows.push(c)
    })
    setPlan(shuffled(windows, seed))
    setResults([])
    setIndex(0)
    setPhase('ready')
  }, [classes, trials, seed])

  // The microphone runs for the whole protocol, exactly as it does for a whole
  // run in the app — stopping and restarting it per window would measure a
  // session lifecycle no operator experiences, and would hide the silence
  // timeouts this bench is partly there to characterise.
  useEffect(() => {
    if (phase === 'idle' || phase === 'done') return
    void SpeechRecognition.startListening({
      owner: OWNER,
      continuous: true,
      language: SPEECH_LANG,
    })
    return () => void SpeechRecognition.stopListening(OWNER)
  }, [phase])

  // Advance through the plan: a short "get ready" pause, then the window.
  useEffect(() => {
    if (phase !== 'ready' || index < 0 || index >= plan.length) return
    const timer = window.setTimeout(() => {
      observationsRef.current = []
      onsetAnyRef.current = null
      onsetCorrectRef.current = null
      seenTranscriptRef.current = ''
      resetTranscript()
      windowStartRef.current = performance.now()
      setPhase('recording')
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [phase, index, plan.length, resetTranscript])

  useEffect(() => {
    if (phase !== 'recording') return
    const timer = window.setTimeout(() => {
      setResults((prev) => [
        ...prev,
        {
          expected: plan[index],
          observations: observationsRef.current,
          transcript: seenTranscriptRef.current,
          onsetAnyS: onsetAnyRef.current,
          onsetCorrectS: onsetCorrectRef.current,
        },
      ])
      if (index + 1 >= plan.length) {
        setPhase('done')
      } else {
        setIndex(index + 1)
        setPhase('ready')
      }
    }, holdS * 1000)
    return () => window.clearTimeout(timer)
  }, [phase, index, plan, holdS])

  // Same trigger production uses: finalised speech only, matched with the same
  // function. Interim hypotheses are still being revised and would credit a
  // recognition that the recognizer itself later withdrew.
  useEffect(() => {
    if (phase !== 'recording' || !finalTranscript) return
    seenTranscriptRef.current = finalTranscript
    const matched = matchVoiceKeyword(finalTranscript)
    if (!matched) return
    const t = (performance.now() - windowStartRef.current) / 1000
    observationsRef.current.push(matched)
    if (onsetAnyRef.current === null) onsetAnyRef.current = t
    if (matched === plan[index] && onsetCorrectRef.current === null) {
      onsetCorrectRef.current = t
    }
    // Clear so the same word can be recognised again inside this window —
    // production does exactly this, for the same reason.
    resetTranscript()
  }, [finalTranscript, phase, index, plan, resetTranscript])

  const download = () => {
    const payload = {
      schema: 'recognition-bench/1',
      channel: 'voice',
      operator,
      trials_per_class: trials,
      hold_s: holdS,
      seed,
      classes,
      silence_class: SILENCE,
      meta: {
        speech_lang: SPEECH_LANG,
        user_agent: navigator.userAgent,
        recorded_at: new Date().toISOString(),
        // Stated, not measured: the Web Speech API is a remote Google service,
        // so this file is a dated observation and not a reproducible artifact
        // — the same caveat the LLM campaign carries for hosted model aliases.
        note: 'Browser Web Speech API (remote service). Not reproducible at a later date.',
      },
      windows: results.map((r) => ({
        expected: r.expected,
        observations: r.observations,
        transcript: r.transcript,
        onset_any_s: r.onsetAnyS,
        onset_correct_s: r.onsetCorrectS,
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `recognition_voice_${operator || 'anon'}_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (!browserSupportsSpeechRecognition) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography variant="h5" gutterBottom>
          Voice bench
        </Typography>
        <Typography>
          This browser has no Web Speech API. The voice channel is Chrome-only,
          so the measurement has to run there too — anywhere else would report
          the absence of a feature rather than its accuracy.
        </Typography>
      </Box>
    )
  }

  const current = index >= 0 && index < plan.length ? plan[index] : null
  const say = current && current !== SILENCE ? spokenExample(current) : ''

  return (
    <Box sx={{ p: 4, maxWidth: 720, mx: 'auto' }}>
      <Typography variant="h5" gutterBottom>
        Voice recognition bench
      </Typography>
      <Typography variant="body2" sx={{ mb: 3, color: 'text.secondary' }}>
        Recognizer language <strong>{SPEECH_LANG}</strong>. Each window asks for
        one command or for silence, in random order. Say the word once, clearly,
        then wait for the next prompt.
      </Typography>

      {phase === 'idle' && (
        <Stack spacing={2}>
          <TextField
            label="Operator id"
            size="small"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            helperText="Anything that identifies this person in your notes — it goes in the result file."
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Trials per class"
              size="small"
              type="number"
              value={trials}
              onChange={(e) => setTrials(Math.max(1, Number(e.target.value)))}
              helperText="30 supports 'error below 10%' with no failures observed; 10 only supports 'below 30%'."
            />
            <TextField
              label="Window (s)"
              size="small"
              type="number"
              value={holdS}
              onChange={(e) => setHoldS(Math.max(2, Number(e.target.value)))}
            />
            <TextField
              label="Seed"
              size="small"
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
              helperText="Same seed, same window order."
            />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {(RECOGNIZED_VOICE_COMMANDS.length + 1) * trials} windows ·{' '}
            {Math.round(
              ((RECOGNIZED_VOICE_COMMANDS.length + 1) *
                trials *
                (holdS + 1.5)) /
                60,
            )}{' '}
            min
          </Typography>
          <Button
            variant="contained"
            onClick={startProtocol}
            disabled={!operator.trim()}
          >
            Start
          </Button>
        </Stack>
      )}

      {(phase === 'ready' || phase === 'recording') && current && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <Typography variant="caption" color="text.secondary">
            {index + 1} / {plan.length} · mic {listening ? 'live' : 'OFF'}
          </Typography>
          <Typography variant="h3" sx={{ my: 2, fontWeight: 700 }}>
            {current === SILENCE ? 'Say nothing' : `“${say}”`}
          </Typography>
          <Typography
            variant="h6"
            sx={{ color: phase === 'recording' ? 'success.dark' : 'grey.600' }}
          >
            {phase === 'recording' ? 'NOW' : 'get ready…'}
          </Typography>
          {!listening && (
            <Typography sx={{ mt: 2, color: 'error.main' }}>
              The recognizer stopped. Reload and restart the protocol — results
              collected while the microphone is off are not measurements.
            </Typography>
          )}
        </Box>
      )}

      {phase === 'done' && (
        <Stack spacing={2}>
          <Typography>
            Done — {results.length} windows recorded. Download the file and run{' '}
            <code>poetry run python testing/recognition_report.py</code> over
            it.
          </Typography>
          <Button variant="contained" onClick={download}>
            Download results
          </Button>
          <Button onClick={() => setPhase('idle')}>Run again</Button>
        </Stack>
      )}
    </Box>
  )
}

export default VoiceBench
