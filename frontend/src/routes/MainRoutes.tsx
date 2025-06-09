import React, { lazy } from 'react'
import { RouteObject } from 'react-router-dom'

import { Loadable } from 'components/Loadable'
import { MainLayout } from 'layout/MainLayout'
import { defaultPath } from 'utils/constants'
import { ProtectedRoute } from './ProtectedRoute'

const ListTasks = Loadable(lazy(() => import('pages/tasks/listTasks')))
const DetailTask = Loadable(lazy(() => import('pages/tasks/detailTask')))
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
const Chat = Loadable(lazy(() => import('pages/chat')))
const Graphic = Loadable(lazy(() => import('pages/graphic')))
const Homepage = Loadable(lazy(() => import('pages/homepage')))
const Faq = Loadable(lazy(() => import('pages/faq')))

export const MainRoutes: RouteObject = {
  path: defaultPath,
  element: (
    <ProtectedRoute>
      <MainLayout />
    </ProtectedRoute>
  ),
  children: [
    {
      path: defaultPath,
      element: (
        <ProtectedRoute>
          <Homepage />
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
      path: 'task/:id',
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
      path: 'chat/:id',
      element: (
        <ProtectedRoute>
          <Chat />
        </ProtectedRoute>
      ),
    },
    {
      path: 'graphic/:id',
      element: (
        <ProtectedRoute>
          <Graphic />
        </ProtectedRoute>
      ),
    },
  ],
}
