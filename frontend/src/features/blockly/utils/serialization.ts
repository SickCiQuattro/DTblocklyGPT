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
export const isValidBlockState = (value: unknown): value is BlockState =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as { type?: unknown }).type === 'string'
