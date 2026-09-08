import { getFromLocalStorage, LocalStorageKey } from 'utils/localStorageUtils'
import { USER_GROUP } from 'utils/constants'

import { define } from './define'
import { libraries } from './libraries'
import { MenuItem } from './types'
import { operations, administration } from './management'

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
  // Operations is shared, Administration is added on top. A manager's menu is
  // now the operator's plus one group, rather than a different arrangement of
  // the same items — so "My Robot" is in the same place whoever is looking.
  const defaultItems = [define, libraries, operations]

  if (group === USER_GROUP.MANAGER) return [...defaultItems, administration]

  return defaultItems
}
