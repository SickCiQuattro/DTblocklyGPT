/**
 * Single source of truth for the gesture and voice-command vocabulary the
 * vision/voice pipeline recognizes. Consumed by both the Blockly block
 * definitions (gesture_block / voice_command_block dropdown options) and the
 * "Test recognition" sandbox legend in DigitalTwinPanel, so the two never
 * drift out of sync.
 */

export interface RecognitionOption {
  label: string
  code: string
}

// Three fingers / Pinch / Pointing removed from the recognized set (2026-07-14).
export const RECOGNIZED_GESTURES: RecognitionOption[] = [
  { label: 'Thumbs up', code: 'THUMBS_UP' },
  { label: 'Thumbs down', code: 'THUMBS_DOWN' },
  { label: 'Open hand', code: 'OPEN_HAND' },
  { label: 'Fist', code: 'FIST' },
  { label: 'Peace sign', code: 'PEACE' },
  { label: 'OK sign', code: 'OK' },
]

export const RECOGNIZED_VOICE_COMMANDS: RecognitionOption[] = [
  { label: 'Yes', code: 'YES' },
  { label: 'No', code: 'NO' },
  { label: 'Done', code: 'DONE' },
  { label: 'Proceed', code: 'PROCEED' },
]

/**
 * Language the browser's speech recognizer listens in — a BCP-47 tag, pinned
 * here rather than read from `navigator.language`.
 *
 * It used to follow the browser locale, which made a study result depend on
 * which laptop the session ran on: the same task, the same spoken word, and a
 * different outcome on an en-US machine than on an it-IT one, with nothing
 * saying so. The Web Speech API takes one language, so this is a choice, not a
 * default that can be avoided.
 *
 * it-IT because the operators speak Italian. The interface is in English and
 * stays that way; what a recognizer needs is the language coming out of the
 * speaker's mouth, which is a different question from the language on screen.
 * Asking an Italian speaker for a clean en-US "proceed" would fold their
 * English pronunciation into the study's headline measure — attempts before
 * resolution — where it does not belong.
 *
 * Override with VITE_SPEECH_LANG (e.g. "en-US") in frontend/.env.
 * Both consumers — the voice-command block and the chat composer — must read
 * THIS constant: the browser allows one recognition session, so they share a
 * single instance and whichever starts last decides its language for both.
 */
export const SPEECH_LANG: string = import.meta.env.VITE_SPEECH_LANG || 'it-IT'

/**
 * Spoken forms accepted for each command, lowercase. The recognizer returns
 * words, not codes, so this is what actually gets matched; the codes above are
 * the internal identity the block and the backend agree on.
 *
 * Both languages stay listed even though only one can be recognized at a time
 * (see SPEECH_LANG) — the list costs nothing and keeps flipping the language
 * to a one-line change instead of a vocabulary rewrite.
 */
export const VOICE_KEYWORDS: Record<string, string[]> = {
  YES: ['yes', 'yeah', 'yep', 'sì', 'si'],
  NO: ['no', 'nope'],
  DONE: ['done', 'finished', 'complete', 'fatto', 'completato'],
  PROCEED: ['proceed', 'go', 'next', 'continue', 'procedi', 'vai', 'avanti'],
}

/**
 * Return the command whose synonym appears LAST in the transcript (so "no,
 * proceed" resolves to PROCEED — what the speaker actually ended on, not
 * whichever command happens to sort first). Punctuation is stripped before
 * tokenising so a final "Yes." still matches.
 *
 * Lives here rather than beside its production caller because the measurement
 * bench (pages/measure/VoiceBench) has to run the SAME matcher: a bench with
 * its own copy would report the accuracy of a matcher nobody uses.
 */
export const matchVoiceKeyword = (transcript: string): string | null => {
  const words = transcript
    .toLowerCase()
    .replace(/[.,!?;:]/g, '')
    .split(/\s+/)
  let found: string | null = null
  for (const w of words) {
    for (const cmd of Object.keys(VOICE_KEYWORDS)) {
      if (VOICE_KEYWORDS[cmd].includes(w)) found = cmd
    }
  }
  return found
}

/** Spoken forms that belong to the Italian recognizer, not the English one. */
const ITALIAN_FORMS = new Set([
  'sì',
  'si',
  'fatto',
  'completato',
  'procedi',
  'vai',
  'avanti',
])

/**
 * What to tell the operator to actually say, in the language the recognizer is
 * listening in. The block's label ("Done") names the step; it is not a
 * pronounceable instruction once the recognizer expects Italian, and a
 * participant reading "Done" to an it-IT recognizer is the failure this
 * exists to prevent.
 */
export const spokenExample = (code: string | null | undefined): string => {
  const words = VOICE_KEYWORDS[String(code ?? '').toUpperCase()] ?? []
  const italian = SPEECH_LANG.startsWith('it')
  return words.find((w) => ITALIAN_FORMS.has(w) === italian) ?? words[0] ?? ''
}

export const GESTURE_DROPDOWN_OPTIONS: [string, string][] =
  RECOGNIZED_GESTURES.map((g) => [g.label, g.code])

/**
 * The command's name plus the word to actually say, when the two differ.
 *
 * "Done" is the name of the step; "fatto" is what an it-IT recognizer will
 * accept. Only the first was ever on screen — in the block's own dropdown, in
 * the Test recognition legend, on the card that previews a task — so a
 * participant read "Done", said "done", and the recognizer heard nothing it
 * knew. "Yes" was the one that happened to work anyway, because "sì" is the
 * obvious guess and nothing else was.
 *
 * The suffix appears only when the spoken form is not the label itself, so
 * flipping VITE_SPEECH_LANG to en-US collapses these back to plain "Yes" and
 * "Done" rather than printing 'Yes ("yes")'.
 */
export const voiceLabelWithSpokenForm = (v: RecognitionOption): string => {
  const say = spokenExample(v.code)
  return !say || say.toLowerCase() === v.label.toLowerCase()
    ? v.label
    : `${v.label} (“${say}”)`
}

export const VOICE_DROPDOWN_OPTIONS: [string, string][] =
  RECOGNIZED_VOICE_COMMANDS.map((v) => [voiceLabelWithSpokenForm(v), v.code])

/**
 * The value both pipelines report for "nothing recognized right now": the ROS
 * gesture topic publishes the string "NONE", the voice hook uses "". Neither
 * is a code in the sets above, so both used to fall through to the raw-code
 * branch and surface verbatim — the panel's Events list read "NONE" next to a
 * hard-coded "none" and an "idle", three spellings of one state.
 */
export const NOTHING_RECOGNIZED = 'None'

const isNothing = (code: string | null | undefined): boolean =>
  code === null || code === undefined || code === '' || code === 'NONE'

/** Plain-language label for a gesture code (e.g. "THUMBS_UP" -> "Thumbs up")
 * — falls back to the raw code, so an unmapped one stays visible instead of
 * being silently reported as nothing. */
export const gestureLabel = (code: string | null | undefined): string =>
  isNothing(code)
    ? NOTHING_RECOGNIZED
    : (RECOGNIZED_GESTURES.find((g) => g.code === code)?.label ?? code ?? '')

/** Same, for a voice-command code (e.g. "PROCEED" -> "Proceed"). */
export const voiceLabel = (code: string | null | undefined): string =>
  isNothing(code)
    ? NOTHING_RECOGNIZED
    : (RECOGNIZED_VOICE_COMMANDS.find((v) => v.code === code)?.label ??
      code ??
      '')

/**
 * `voiceLabelWithSpokenForm` addressed by CODE rather than by option.
 *
 * The panel's REQUIRED readout knows a code, not an option, and it was
 * therefore printing the bare label — the command's English NAME — under a
 * 30-second clock while the recogniser listens in Italian. The utterance that
 * actually matches lived only in the legend, on a tab the panel disables for
 * the whole duration of a run, so mid-wait it was unreachable.
 *
 * Delegates rather than re-composing the string: one format, one place, so the
 * legend and the readout cannot drift into showing the same thing two ways.
 */
export const voiceLabelWithSpokenFormByCode = (
  code: string | null | undefined,
): string => {
  if (isNothing(code)) return NOTHING_RECOGNIZED
  const option = RECOGNIZED_VOICE_COMMANDS.find((v) => v.code === code)
  return option ? voiceLabelWithSpokenForm(option) : (code ?? '')
}
