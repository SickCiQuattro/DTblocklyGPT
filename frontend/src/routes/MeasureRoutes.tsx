import React, { lazy } from 'react'
import { RouteObject } from 'react-router-dom'

import { Loadable } from 'components/Loadable'
import { defaultPath } from 'utils/constants'

import { ProtectedRoute } from './ProtectedRoute'

const VoiceBench = Loadable(lazy(() => import('pages/measure/VoiceBench')))

/**
 * Measurement instruments, reachable by URL only.
 *
 * Deliberately outside MainLayout: the nav rail and header are product
 * surface, and a protocol that asks an operator to say one word into a quiet
 * room should not put a robot panel and a task list next to the prompt.
 * Deliberately not in any menu either — an operator who wanders in here during
 * a study session is running a measurement, not the app.
 *
 * Still behind ProtectedRoute: the bench itself needs no server call, but an
 * unauthenticated visitor to any app URL belongs at the login page.
 */
export const MeasureRoutes: RouteObject = {
  path: defaultPath,
  children: [
    {
      path: 'measure/voice',
      element: (
        <ProtectedRoute>
          <VoiceBench />
        </ProtectedRoute>
      ),
    },
  ],
}
