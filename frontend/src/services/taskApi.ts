import axios from 'axios'

import { endpoints } from './endpoints'

// ── Payload / Response types ──────────────────────────────────────────────────

export interface PublishTaskPayload {
  id: number
  taskStructure: unknown
  dependencies?: number[]
  forcePublish?: boolean
}

export type PublishTaskResult =
  | { type: 'published'; signature: string }
  | { type: 'breaking_changes'; stale_deps: number[] }
  | { type: 'cycle'; stale_deps: number[] }
  | { type: 'error'; message: string }

// ── API calls ─────────────────────────────────────────────────────────────────

/** PUT api/task/save-draft/ — persists draft_workspace for any task type */
export const saveTaskDraft = (id: number, taskStructure: unknown) =>
  axios.put(endpoints.task.saveDraft, { id, taskStructure })

/**
 * POST api/task/publish/ — publishes any task type.
 * Mirrors publishMacro() in macroApi.ts — same result shape.
 */
export const publishTask = async (
  payload: PublishTaskPayload,
): Promise<PublishTaskResult> => {
  try {
    const res = await axios.post(endpoints.task.publish, payload)
    return { type: 'published', signature: res.data.payload?.signature ?? '' }
  } catch (err: any) {
    const status = err.response?.status
    const data = err.response?.data

    if (status === 202) {
      return {
        type: 'breaking_changes',
        stale_deps: data?.data?.stale_deps ?? [],
      }
    }
    if (status === 409) {
      return { type: 'cycle', stale_deps: data?.data?.stale_deps ?? [] }
    }
    return { type: 'error', message: data?.message ?? 'Unknown error' }
  }
}

/** POST api/task/discard-draft/ — reverts draft_workspace to published_workspace */
export const discardTaskDraft = (id: number) =>
  axios.post(endpoints.task.discardDraft, { id })
