import React, { lazy } from 'react'
import { RouteObject } from 'react-router-dom'

import { Loadable } from 'components/Loadable'
import { MainLayout } from 'layout/MainLayout'
import { defaultPath } from 'utils/constants'
import { ProtectedRoute, GroupRoute } from './ProtectedRoute'

const ListUsers = Loadable(lazy(() => import('pages/users/listUsers')))
const DetailUser = Loadable(lazy(() => import('pages/users/detailUser')))
const ListRobots = Loadable(lazy(() => import('pages/robots/listRobots')))
const DetailRobot = Loadable(lazy(() => import('pages/robots/detailRobot')))

export const ManagerRoutes: RouteObject = {
  path: defaultPath,
  element: (
    <ProtectedRoute>
      <MainLayout />
    </ProtectedRoute>
  ),
  children: [
    {
      path: 'users',
      element: (
        <ProtectedRoute>
          <GroupRoute>
            <ListUsers />
          </GroupRoute>
        </ProtectedRoute>
      ),
    },
    {
      path: 'user/:id',
      element: (
        <ProtectedRoute>
          <GroupRoute>
            <DetailUser />
          </GroupRoute>
        </ProtectedRoute>
      ),
    },
    {
      path: 'robots',
      element: (
        <ProtectedRoute>
          <GroupRoute>
            <ListRobots />
          </GroupRoute>
        </ProtectedRoute>
      ),
    },
    {
      path: 'robot/:id',
      element: (
        <ProtectedRoute>
          <GroupRoute>
            <DetailRobot />
          </GroupRoute>
        </ProtectedRoute>
      ),
    },
  ],
}
