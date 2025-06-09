import { getFromLocalStorage, LocalStorageKey } from 'utils/localStorageUtils'
import { USER_GROUP } from 'utils/constants'
import { define } from './define'
import { libraries } from './libraries'
import { MenuItem } from './types'
import { managementManager, managementOperator } from './management'
import { homepage } from './homepage'

export const getMenuItems = (): MenuItem[] => {
  const { group } = getFromLocalStorage(LocalStorageKey.USER)
  const defaultItems = [homepage, define, libraries]

  if (group === USER_GROUP.MANAGER) return [...defaultItems, managementManager]

  return [...defaultItems, managementOperator]
}
