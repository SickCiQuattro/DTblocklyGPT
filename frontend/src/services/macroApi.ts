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
