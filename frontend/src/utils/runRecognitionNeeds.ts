/**
 * Which recognition channels a run will actually use — including the ones
 * hidden inside Saved Tasks.
 *
 * The camera and the microphone are started before a run, not when the waiting
 * step is reached: acquiring a webcam takes long enough that a gesture step
 * beginning at t=0 of the acquisition sends no frames at all (see the note in
 * useWebcamVision). So the panel has to know in advance what the program needs.
 *
 * "In advance" used to mean scanning the blocks on the canvas, which is wrong
 * for exactly one construct and it is the one the user study leans on: a Saved
 * Task's steps live in ANOTHER task's workspace. A task whose only gesture step
 * sits inside a macro looked like it needed nothing, the webcam never started,
 * and the step waited its full timeout with the operator gesturing at a camera
 * that was never on. Same for voice.
 *
 * find_object is deliberately NOT here: it reads the robot's own camera through
 * vision_node, never the operator's browser webcam, so it needs no permission
 * and no stream from this side.
 */
import * as Blockly from 'blockly/core'

import { getMacroIdFromBlockData } from 'features/blockly/editor/macroExplosion'
import { parseJson } from 'features/blockly/utils/serialization'

export interface RecognitionNeeds {
  /** A gesture step exists — the browser webcam has to be streaming. */
  camera: boolean
  /** A voice step exists — the microphone has to be listening. */
  voice: boolean
  /**
   * Any step at all that waits on the operator, including the two above plus
   * the Confirm button and find_object. Wider than camera||voice because auto
   * mode short-circuits all four, so the warning about it has to cover all
   * four — and it has the same macro blind spot, for the same reason.
   */
  humanStep: boolean
}

const GESTURE_BLOCK = 'gesture_block'
const VOICE_BLOCK = 'voice_command_block'
const MACRO_BLOCK = 'macro_task_block'
const HUMAN_STEP_BLOCKS = [
  'human_action_block',
  GESTURE_BLOCK,
  VOICE_BLOCK,
  'find_object_block',
  'human_feedback_block',
]

/** Every `type` string anywhere in a serialized Blockly workspace.
 *
 * Walks the JSON structurally rather than matching the schema (blocks nest
 * through `inputs`, `next`, `blocks`, and statement inputs), so a block buried
 * in a loop body inside a conditional is found the same as a top-level one.
 */
const blockTypesIn = (node: unknown, out: Set<string>): void => {
  if (Array.isArray(node)) {
    node.forEach((child) => blockTypesIn(child, out))
    return
  }
  if (!node || typeof node !== 'object') return
  const record = node as Record<string, unknown>
  if (typeof record.type === 'string') out.add(record.type)
  Object.values(record).forEach((child) => blockTypesIn(child, out))
}

/** Macro id → its published workspace, however the API delivered it. */
export type MacroWorkspaces = Map<string, unknown>

const typesOfMacro = (
  macroId: string,
  macros: MacroWorkspaces,
  seen: Set<string>,
): Set<string> => {
  const types = new Set<string>()
  // A macro that references itself, directly or through a chain, would recurse
  // forever. Publishing does not reject that today — CLAUDE.md records the
  // cycle check as scaffolded and never wired up — so the guard belongs here.
  if (seen.has(macroId)) return types
  seen.add(macroId)

  const raw = macros.get(macroId)
  const workspace = typeof raw === 'string' ? parseJson<unknown>(raw) : raw
  if (!workspace) return types

  blockTypesIn(workspace, types)

  // Nested Saved Tasks: their ids live in the serialized `data` payload, which
  // blockTypesIn does not interpret. Re-walk the JSON for those.
  const nested = new Set<string>()
  collectMacroIds(workspace, nested)
  nested.forEach((id) => {
    typesOfMacro(id, macros, seen).forEach((t) => types.add(t))
  })
  return types
}

const collectMacroIds = (node: unknown, out: Set<string>): void => {
  if (Array.isArray(node)) {
    node.forEach((child) => collectMacroIds(child, out))
    return
  }
  if (!node || typeof node !== 'object') return
  const record = node as Record<string, unknown>
  if (record.type === MACRO_BLOCK) {
    const id = getMacroIdFromBlockData(record.data)
    if (id) out.add(id)
  }
  Object.values(record).forEach((child) => collectMacroIds(child, out))
}

/**
 * What the given canvas needs, following every Saved Task it references.
 *
 * `macros` maps a macro's id to its published workspace; the panel gets it from
 * the same SWR key the editor already uses, so this costs no extra request.
 * A macro missing from the map contributes nothing — its content is genuinely
 * unknown here, and guessing "needs a camera" would prompt for one on tasks
 * that never use it.
 */
export const recognitionNeedsOf = (
  workspace: Blockly.WorkspaceSvg | null | undefined,
  macros: MacroWorkspaces,
): RecognitionNeeds => {
  if (!workspace) return { camera: false, voice: false, humanStep: false }

  const types = new Set<string>()
  const macroIds = new Set<string>()
  workspace.getAllBlocks(false).forEach((block) => {
    types.add(block.type)
    if (block.type === MACRO_BLOCK) {
      const id = getMacroIdFromBlockData(block.data)
      if (id) macroIds.add(id)
    }
  })

  const seen = new Set<string>()
  macroIds.forEach((id) => {
    typesOfMacro(id, macros, seen).forEach((t) => types.add(t))
  })

  return {
    camera: types.has(GESTURE_BLOCK),
    voice: types.has(VOICE_BLOCK),
    humanStep: HUMAN_STEP_BLOCKS.some((t) => types.has(t)),
  }
}
