import { useRoutes } from 'react-router-dom'

import { getFromLocalStorage, LocalStorageKey } from 'utils/localStorageUtils'
import { USER_GROUP } from 'utils/constants'

import { ManagerRoutes } from './AdminRoutes'
import { UserRoutes } from './UserRoutes'
import { AuthRoutes } from './AuthRoutes'
import { MainRoutes } from './MainRoutes'
import { MeasureRoutes } from './MeasureRoutes'

export const Routes = () => {
  const { group } = getFromLocalStorage(LocalStorageKey.USER)

  const defaultRoutes = [MainRoutes, AuthRoutes, UserRoutes, MeasureRoutes]
  const routes =
    group === USER_GROUP.MANAGER
      ? [...defaultRoutes, ManagerRoutes]
      : defaultRoutes

  return useRoutes(routes)
}
