import React, { lazy } from 'react'
import { Navigate, RouteObject } from 'react-router-dom'

import { Loadable } from 'components/Loadable'
import { MainLayout } from 'layout/MainLayout'
import { defaultPath } from 'utils/constants'

import { ProtectedRoute } from './ProtectedRoute'

const ListTasks = Loadable(lazy(() => import('pages/tasks/listTasks')))
const DetailTask = Loadable(lazy(() => import('pages/tasks/detailTask')))
const UnifiedWorkspace = Loadable(lazy(() => import('pages/task-workspace')))
const ListObjects = Loadable(lazy(() => import('pages/objects/listObjects')))
const DetailObject = Loadable(lazy(() => import('pages/objects/detailObject')))
const ListLocations = Loadable(
  lazy(() => import('pages/locations/listLocations')),
)
const DetailLocation = Loadable(
  lazy(() => import('pages/locations/detailLocation')),
)
const ListActions = Loadable(lazy(() => import('pages/actions/listActions')))
const DetailAction = Loadable(lazy(() => import('pages/actions/detailAction')))
const ListMyRobots = Loadable(lazy(() => import('pages/myrobots/listMyRobots')))
const DetailMyRobot = Loadable(
  lazy(() => import('pages/myrobots/detailMyRobot')),
)
const Faq = Loadable(lazy(() => import('pages/faq')))
const PageNotFound = Loadable(lazy(() => import('pages/pageNotFound')))

export const MainRoutes: RouteObject = {
  path: defaultPath,
  element: (
    <ProtectedRoute>
      <MainLayout />
    </ProtectedRoute>
  ),
  children: [
    {
      // Dashboard-first: / redirects to /tasks
      path: defaultPath,
      element: (
        <ProtectedRoute>
          <Navigate to="/tasks" replace />
        </ProtectedRoute>
      ),
    },
    {
      path: 'faq',
      element: (
        <ProtectedRoute>
          <Faq />
        </ProtectedRoute>
      ),
    },
    {
      path: 'tasks',
      element: (
        <ProtectedRoute>
          <ListTasks />
        </ProtectedRoute>
      ),
    },
    {
      // Legacy detail route — kept for backward compat
      path: 'task/:id',
      element: (
        <ProtectedRoute>
          <UnifiedWorkspace />
        </ProtectedRoute>
      ),
    },
    {
      // New task draft
      path: 'task/new',
      element: (
        <ProtectedRoute>
          <UnifiedWorkspace />
        </ProtectedRoute>
      ),
    },
    {
      // Task metadata / details form
      path: 'task/:id/details',
      element: (
        <ProtectedRoute>
          <DetailTask />
        </ProtectedRoute>
      ),
    },
    {
      path: 'objects',
      element: (
        <ProtectedRoute>
          <ListObjects />
        </ProtectedRoute>
      ),
    },
    {
      path: 'object/:id',
      element: (
        <ProtectedRoute>
          <DetailObject />
        </ProtectedRoute>
      ),
    },
    {
      path: 'locations',
      element: (
        <ProtectedRoute>
          <ListLocations />
        </ProtectedRoute>
      ),
    },
    {
      path: 'location/:id',
      element: (
        <ProtectedRoute>
          <DetailLocation />
        </ProtectedRoute>
      ),
    },
    {
      path: 'actions',
      element: (
        <ProtectedRoute>
          <ListActions />
        </ProtectedRoute>
      ),
    },
    {
      path: 'action/:id',
      element: (
        <ProtectedRoute>
          <DetailAction />
        </ProtectedRoute>
      ),
    },
    {
      path: 'myrobots',
      element: (
        <ProtectedRoute>
          <ListMyRobots />
        </ProtectedRoute>
      ),
    },
    {
      path: 'myrobot/:id',
      element: (
        <ProtectedRoute>
          <DetailMyRobot />
        </ProtectedRoute>
      ),
    },
    {
      // Authenticated catch-all — without this, an unknown path under a
      // logged-in session fell through to AuthRoutes' wildcard and rendered
      // the 404 page in the bare unauthenticated layout, without app chrome.
      path: '*',
      element: (
        <ProtectedRoute>
          <PageNotFound />
        </ProtectedRoute>
      ),
    },
  ],
}
