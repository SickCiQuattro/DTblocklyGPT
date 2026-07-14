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

export const GESTURE_DROPDOWN_OPTIONS: [string, string][] =
  RECOGNIZED_GESTURES.map((g) => [g.label, g.code])

export const VOICE_DROPDOWN_OPTIONS: [string, string][] =
  RECOGNIZED_VOICE_COMMANDS.map((v) => [v.label, v.code])
