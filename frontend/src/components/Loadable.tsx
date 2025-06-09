/* eslint-disable react/display-name */
import React, { Suspense } from 'react'

import { Loader } from './Loader'

export const Loadable = (Component) => (props) =>
  (
    <Suspense fallback={<Loader />}>
      <Component {...props} />
    </Suspense>
  )
