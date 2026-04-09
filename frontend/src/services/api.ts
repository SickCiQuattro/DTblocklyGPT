import { BareFetcher, Key, Middleware, SWRConfiguration, SWRHook } from 'swr'
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios'
import { toast } from 'react-toastify'
import Cookies from 'js-cookie'

import { MessageText } from 'utils/messages'
import { clearLocalStorage } from 'utils/localStorageUtils'

export enum MethodHTTP {
  GET = 'GET',
  POST = 'POST',
  DELETE = 'DELETE',
  PUT = 'PUT',
}

export interface ResponseInterface {
  msg: string
  timestamp: string
  status: number
  payload: unknown
}

axios.defaults.timeout = 60000 // 60 seconds
axios.defaults.withCredentials = true
axios.defaults.withXSRFToken = true
axios.defaults.xsrfHeaderName = 'X-CSRFToken'
axios.defaults.xsrfCookieName = 'csrftoken'
axios.defaults.headers.common['Content-Type'] = 'application/json'
axios.defaults.headers.common['X-CSRFToken'] = Cookies.get('csrftoken') || ''

interface FetchApiParamsInterface<TBody extends object = object> {
  url: string
  body?: TBody
  method?: MethodHTTP
}

export const fetchApi = async <
  TResponse = unknown,
  TBody extends object = object,
>({
  url,
  body = {} as TBody,
  method = MethodHTTP.GET,
}: FetchApiParamsInterface<TBody>): Promise<TResponse> => {
  const apiParameters = method === MethodHTTP.GET ? body : {}
  const apiData = method !== MethodHTTP.GET ? body : {}
  const options: AxiosRequestConfig = {
    url,
    method, // Axios default is GET
    data: apiData,
    params: apiParameters,
  }

  const hasRecords = (
    payload: unknown,
  ): payload is { records: TResponse | null } => {
    return (
      typeof payload === 'object' && payload !== null && 'records' in payload
    )
  }

  return axios(options)
    .then((response: AxiosResponse<ResponseInterface>) => response.data)
    .then((response: ResponseInterface) =>
      hasRecords(response.payload)
        ? (response.payload.records as TResponse)
        : (response.payload as TResponse),
    )
    .catch((error: AxiosError<{ message?: string; payload?: TResponse }>) => {
      if (error.response) {
        const err = new Error(error.response.data?.message || 'No connection')
        err.name = error.response.status.toString()
        switch (error.response.status) {
          case 0:
            toast.error(MessageText.noConnection)
            break
          case 400:
            toast.error(err.message)
            return error.response.data.payload as TResponse
          case 401:
            toast.error(err.message)
            break
          case 403:
            toast.error(MessageText.forbidden)
            clearLocalStorage()
            Cookies.remove('csrftoken')
            Cookies.remove('sessionid')
            break
          case 500:
            toast.error(err.message)
            break
          default:
            toast.error(err.message)
        }
        throw err
      }
      toast.error(MessageText.noConnection)
      const err = new Error(error.message || MessageText.noConnection)
      err.name = error.code?.toString() || '500'
      throw err
    })
}

const disableCache: Middleware = (useSWRNext: SWRHook) => {
  return <Data = unknown, Error = unknown>(
    key: Key,
    fetcher: BareFetcher<Data> | null,
    config: SWRConfiguration<Data, Error, BareFetcher<Data>>,
  ) => {
    const swr = useSWRNext(key, fetcher, config)
    const { data, isValidating } = swr
    return { ...swr, data: isValidating ? undefined : data }
  }
}

export const swrParams: SWRConfiguration = {
  fetcher: fetchApi,
  revalidateIfStale: true,
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  revalidateOnMount: true,
  refreshWhenHidden: true,
  refreshWhenOffline: true,
  shouldRetryOnError: false,
  focusThrottleInterval: 0,
  errorRetryCount: 0,
  use: [disableCache],
}
