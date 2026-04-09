import React, { JSX, useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useDispatch } from 'react-redux'

import { UserLoginInterface } from 'pages/login/LoginForm'
import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { defaultOpenItem, defaultPath, USER_GROUP } from 'utils/constants'
import {
  getFromLocalStorage,
  LocalStorageKey,
  removeFromLocalStorage,
  setToLocalStorage,
} from 'utils/localStorageUtils'
import { LoadingSpinner } from 'components/loadingSpinner'
import { activeItem } from 'store/reducers/menu'

interface ProtectedRouteProps {
  children: JSX.Element
}

interface VerifyTokenResponse {
  authError?: boolean
  id: string | number
  username: string
  group: USER_GROUP | string
  versionServer: string
}

export const ProtectedRoute = ({
  children,
}: ProtectedRouteProps): JSX.Element => {
  const hasStoredUser = Boolean(getFromLocalStorage(LocalStorageKey.USER))
  const [loading, setLoading] = useState(hasStoredUser)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  const verifyToken = useCallback(async () => {
    return fetchApi<VerifyTokenResponse, { id: string | number }>({
      url: endpoints.auth.verifyToken,
      method: MethodHTTP.POST,
      body: { id: getFromLocalStorage(LocalStorageKey.USER).id },
    }).then((res) => {
      removeFromLocalStorage(LocalStorageKey.USER)
      if (!res.authError) {
        const userInfo: UserLoginInterface = {
          id: String(res.id),
          username: res.username,
          group: res.group as USER_GROUP,
          versionServer: res.versionServer,
        }
        setToLocalStorage(LocalStorageKey.USER, userInfo)
        setIsAuthenticated(true)
      }
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!hasStoredUser) {
      return
    }
    void verifyToken()
  }, [hasStoredUser, verifyToken])

  if (isAuthenticated) return children
  return loading ? <LoadingSpinner /> : <Navigate to="/login" replace />
}

export const PublicRoute = ({ children }: ProtectedRouteProps) => {
  const user = getFromLocalStorage(LocalStorageKey.USER)
  const dispatch = useDispatch()

  if (user) {
    dispatch(activeItem(defaultOpenItem))
    return <Navigate to={defaultPath} replace />
  }

  return children
}

export const GroupRoute = ({ children }: ProtectedRouteProps) => {
  const { group } = getFromLocalStorage(LocalStorageKey.USER)
  const dispatch = useDispatch()

  if (group !== USER_GROUP.MANAGER) {
    dispatch(activeItem(defaultOpenItem))
    return <Navigate to={defaultPath} replace />
  }

  return children
}
