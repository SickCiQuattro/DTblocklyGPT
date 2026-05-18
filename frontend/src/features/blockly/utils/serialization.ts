/**
 * utils/serialization.ts
 *
 * Pure utility functions for safely parsing and validating Blockly block state
 * JSON. Used by `MacroPreviewModal` and any other code that deserialises a raw
 * `block.data` or task code string into a typed `BlockState`.
 */
import { BlockState } from 'utils/blocklyTypes'

/**
 * Safely parse a JSON string and return `null` when the payload is invalid.
 */
export const parseJson = <T>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/**
 * Runtime guard for a serialized Blockly block state object.
 */
export const isValidBlockState = (
  value: unknown,
): value is BlockState | BlockState[] => {
  if (Array.isArray(value)) {
    return (
      value.length > 0 &&
      value.every(
        (val) =>
          !!val &&
          typeof val === 'object' &&
          typeof (val as { type?: unknown }).type === 'string',
      )
    )
  }
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

const ABSTRACT_STEP_TYPES = new Set([
  'pick',
  'place',
  'processing',
  'move_to',
  'move_relative',
  'gripper',
  'repeat',
  'when',
  'human_action',
  'wait_for_human',
])

export const isAbstractStepLike = (value: unknown): value is import('pages/tasks/types').AbstractStep =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { type?: unknown }).type === 'string' &&
  ABSTRACT_STEP_TYPES.has((value as { type: string }).type)

export const isAbstractStepArray = (value: unknown): value is import('pages/tasks/types').AbstractStep[] =>
  Array.isArray(value) && value.length > 0 && value.every(isAbstractStepLike)
