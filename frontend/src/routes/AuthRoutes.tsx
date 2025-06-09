import React, { lazy } from 'react'
import { RouteObject } from 'react-router-dom'

import { Loadable } from 'components/Loadable'
import { MinimalLayout } from 'layout/MinimalLayout'
import { defaultPath } from 'utils/constants'
import { PublicRoute } from './ProtectedRoute'

const AuthLogin = Loadable(lazy(() => import('pages/login')))
const PageNotFound = Loadable(lazy(() => import('pages/pageNotFound')))

export const AuthRoutes: RouteObject = {
  path: defaultPath,
  element: <MinimalLayout />,
  children: [
    {
      path: 'login',
      element: (
        <PublicRoute>
          <AuthLogin />
        </PublicRoute>
      ),
    },
    {
      path: '*',
      element: <PageNotFound />,
    },
  ],
}
