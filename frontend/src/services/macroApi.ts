// NOT WIRED: no component imports from this module (mirrors taskApi.ts, see
// its header comment for the full explanation). `endpoints.macro` is a
// literal alias of `endpoints.task` (services/endpoints.ts) — there is no
// separate macro-publish route on the backend for this to call even if it
// were wired up. See docs/internal/analisi-sistema/p2-2-ciclo-vita-task.md §5.5.
import axios, { AxiosRequestConfig } from 'axios'

import type {
  PublishMacroPayload,
  PublishMacroResponse,
  PublishMacroBreakingChanges,
} from 'pages/tasks/types'

import { endpoints } from './endpoints'

export type PublishMacroResult =
  | { type: 'published'; signature: string }
  | { type: 'breaking_changes'; stale_deps: number[] }
  | { type: 'cycle'; stale_deps: number[] }
  | { type: 'error'; message: string }

export const publishMacro = async (
  payload: PublishMacroPayload,
): Promise<PublishMacroResult> => {
  try {
    const res = await axios.post(endpoints.macro.publish, payload)
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

export const saveMacroDraft = (id: number, taskStructure: unknown) =>
  axios.put(endpoints.macro.saveDraft, { id, taskStructure })

export const discardMacroDraft = (id: number) =>
  axios.post(endpoints.macro.discardDraft, { id })
