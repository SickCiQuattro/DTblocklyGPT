import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Audible feedback for the three moments of an operator step.
 *
 * Every confirmation the system gives is visual and lives inside the robot
 * panel, which is on the screen. The four confirmation channels are not
 * equidistant from the screen: the Confirm button is under your hand, a
 * gesture is performed in front of the laptop's own webcam, but a spoken word
 * only needs the microphone to reach you, and an object has to be presented to
 * the camera at the CELL — where you are looking at the arm, not at the panel.
 *
 * So a screen-only acknowledgement penalises two channels of four, unequally.
 * That matters here beyond comfort: Part B measures attempts before resolution
 * and time to resolution (studio-utenti/07-parteB.md), and an operator who did
 * the right thing and could not tell that it landed does it again. The extra
 * attempt and the extra seconds are recorded against the channel while they
 * belong to the feedback.
 *
 * Which is also why the cue is IDENTICAL across the four channels. A different
 * sound per channel — or worse, per gesture — would hand the operator
 * information the study is trying to measure them finding on their own, and
 * would reintroduce as a difference the very asymmetry this removes.
 *
 * Additive, never a replacement: the pills, the REQUIRED/DETECTED readout and
 * the STATUS live region all stay exactly as they were. An operator who cannot
 * hear loses nothing they had before.
 */

/** Synthesised, so there is no asset to ship, fetch, or licence. */
type Cue = 'waiting' | 'accepted' | 'failed'

/** [frequency Hz, start offset s, duration s] per note. */
const CUES: Record<Cue, [number, number, number][]> = {
  // One clear note: "the program has reached a step that needs you". This is
  // the cue that matters most and the one the app had no equivalent of at all
  // — standing at the rack with a tube in hand, nothing told you the run had
  // got there.
  waiting: [[660, 0, 0.14]],
  // Rising pair — accepted.
  accepted: [
    [880, 0, 0.09],
    [1320, 0.09, 0.11],
  ],
  // Falling pair, lower: timed out, or the run stopped.
  failed: [
    [440, 0, 0.12],
    [330, 0.12, 0.16],
  ],
}

const STORAGE_KEY = 'recognitionSoundEnabled'

/** Quiet on purpose. The session is recorded on a separate device and the
 *  microphone is open for the whole run (useVoiceCommand listens with
 *  `continuous: true`), so these tones are heard by both. They cannot be
 *  mistaken for a command — `matchVoiceKeyword` only accepts the four exact
 *  words — but there is no reason for them to be loud. */
const PEAK_GAIN = 0.09

export const useRecognitionSound = () => {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem(STORAGE_KEY) !== 'false'
  })
  const contextRef = useRef<AudioContext | null>(null)

  const persistEnabled = useCallback((next: boolean) => {
    setEnabled(next)
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, String(next))
    }
  }, [])

  /**
   * Call from a click handler. Browsers refuse to start audio until the page
   * has had a user gesture, and a context created later starts `suspended` —
   * every cue would then be dropped in silence, with nothing on screen saying
   * so. Run is the gesture: by the time a step needs a sound, the operator has
   * pressed it.
   */
  const unlock = useCallback(() => {
    try {
      contextRef.current ??= new AudioContext()
      if (contextRef.current.state === 'suspended') {
        void contextRef.current.resume()
      }
    } catch {
      // No Web Audio: the visual feedback is unchanged, so there is nothing to
      // report and nothing to fall back to.
    }
  }, [])

  const play = useCallback(
    (cue: Cue) => {
      if (!enabled) return
      const ctx = contextRef.current
      if (!ctx || ctx.state !== 'running') return
      const now = ctx.currentTime
      for (const [frequency, offset, duration] of CUES[cue]) {
        const oscillator = ctx.createOscillator()
        const gain = ctx.createGain()
        oscillator.type = 'sine'
        oscillator.frequency.value = frequency
        // Ramped rather than switched: a gain that jumps from 0 produces a
        // click at both ends, which on a short tone is most of what you hear.
        gain.gain.setValueAtTime(0, now + offset)
        gain.gain.linearRampToValueAtTime(PEAK_GAIN, now + offset + 0.015)
        gain.gain.linearRampToValueAtTime(0, now + offset + duration)
        oscillator.connect(gain).connect(ctx.destination)
        oscillator.start(now + offset)
        oscillator.stop(now + offset + duration + 0.02)
      }
    },
    [enabled],
  )

  useEffect(
    () => () => {
      void contextRef.current?.close()
      contextRef.current = null
    },
    [],
  )

  return { play, unlock, enabled, setEnabled: persistEnabled }
}
