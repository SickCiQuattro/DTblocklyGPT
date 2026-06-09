import { getFromLocalStorage, LocalStorageKey } from 'utils/localStorageUtils'
import { USER_GROUP } from 'utils/constants'

import { define } from './define'
import { libraries } from './libraries'
import { MenuItem } from './types'
import { managementManager, managementOperator } from './management'

export const getMenuItems = (): MenuItem[] => {
  const storedUser: unknown = getFromLocalStorage(LocalStorageKey.USER)
  const validGroups = Object.values(USER_GROUP)
  const group =
    typeof storedUser === 'object' &&
    storedUser !== null &&
    'group' in storedUser &&
    typeof storedUser.group === 'string' &&
    validGroups.includes(storedUser.group as USER_GROUP)
      ? (storedUser.group as USER_GROUP)
      : undefined
  const defaultItems = [define, libraries]

  if (group === USER_GROUP.MANAGER) return [...defaultItems, managementManager]

  return [...defaultItems, managementOperator]
}
