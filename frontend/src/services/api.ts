import { BareFetcher, Key, Middleware, SWRConfiguration, SWRHook } from 'swr'
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios'
import { toast } from 'react-toastify'
import { MessageText } from 'utils/messages'
import Cookies from 'js-cookie'
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
  payload: any
}

axios.defaults.timeout = 60000 // 60 seconds
axios.defaults.withCredentials = true
axios.defaults.withXSRFToken = true
axios.defaults.xsrfHeaderName = 'X-CSRFToken'
axios.defaults.xsrfCookieName = 'csrftoken'
axios.defaults.headers.common['Content-Type'] = 'application/json'
axios.defaults.headers.common['X-CSRFToken'] = Cookies.get('csrftoken') || ''

interface FetchApiParamsInterface {
  url: string
  body?: any
  method?: MethodHTTP
}

export const fetchApi = async ({
  url,
  body = {},
  method = MethodHTTP.GET,
}: FetchApiParamsInterface) => {
  const apiParameters = method === MethodHTTP.GET ? { ...body } : {}
  const apiData = method !== MethodHTTP.GET ? { ...body } : {}
  const options: AxiosRequestConfig = {
    url,
    method, // Axios default is GET
    data: { ...apiData },
    params: { ...apiParameters },
  }

  return axios(options)
    .then((response: AxiosResponse) => response.data)
    .then((response: ResponseInterface) =>
      response.payload !== null && response.payload.records !== undefined
        ? response.payload.records
        : response.payload,
    )
    .catch((error: AxiosError<any>) => {
      if (error.response) {
        const err = new Error(error.response.data?.message || 'No connection')
        err.name = error.response.status.toString()
        switch (error.response.status) {
          case 0:
            toast.error(MessageText.noConnection)
            break
          case 400:
            toast.error(err.message)
            return error.response.data.payload
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
  return <Data = any, Error = any>(
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
