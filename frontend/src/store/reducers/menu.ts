import { createSlice, PayloadAction } from '@reduxjs/toolkit'

import { defaultOpenItem } from 'utils/constants'

export type MenuState = {
  openItem: string
  drawerOpen: boolean
}

const selectDefaultOpenItem = (): string => {
  const path = window.location.pathname
  const pathArray = path.split('/')
  const pathItem = pathArray[pathArray.length - 1]
  return pathItem || defaultOpenItem
}

const initialState: MenuState = {
  openItem: selectDefaultOpenItem(),
  drawerOpen: window.innerWidth > 600,
}

const menuSlice = createSlice({
  name: 'menu',
  initialState,
  reducers: {
    activeItem(state, action: PayloadAction<string>) {
      return {
        ...state,
        openItem: action.payload,
      }
    },

    openDrawer(state, action: PayloadAction<boolean>) {
      return {
        ...state,
        drawerOpen: action.payload,
      }
    },
  },
})

export const { activeItem, openDrawer } = menuSlice.actions
export const menuReducers = menuSlice.reducer
