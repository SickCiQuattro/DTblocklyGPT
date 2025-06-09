import React, { useState } from 'react'
import { useTheme } from '@mui/material/styles'
import { List, ListItemButton, ListItemIcon, ListItemText } from '@mui/material'
import { KeyOutlined, LogoutOutlined, SettingOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { toast } from 'react-toastify'

import {
  LocalStorageKey,
  removeFromLocalStorage,
} from 'utils/localStorageUtils'
import { activeItem } from 'store/reducers/menu'
import { MessageText } from 'utils/messages'

interface ProfileTabProps {
  setOpen: (open: boolean) => void
}

export const ProfileTab = ({ setOpen }: ProfileTabProps) => {
  const theme = useTheme()
  const dispatch = useDispatch()
  const navigate = useNavigate()

  const [selectedIndex, setSelectedIndex] = useState(-1)

  const handleListItemClick = (index: number, id: string) => {
    dispatch(activeItem(id))
    setSelectedIndex(index)
    navigate(`/${id}`)
    setOpen(false)
  }

  const handleLogout = async () => {
    setSelectedIndex(1)
    removeFromLocalStorage(LocalStorageKey.TOKEN)
    removeFromLocalStorage(LocalStorageKey.USER)
    toast.success(MessageText.logoutSuccess)
    navigate('/login')
  }

  return (
    <List
      component="nav"
      sx={{
        p: 0,
        '& .MuiListItemIcon-root': {
          minWidth: 32,
          color: theme.palette.grey[500],
        },
      }}
    >
      <ListItemButton
        selected={selectedIndex === 1}
        onClick={() => handleListItemClick(1, 'impostazioni')}
      >
        <ListItemIcon>
          <SettingOutlined />
        </ListItemIcon>
        <ListItemText primary="Impostazioni" />
      </ListItemButton>

      <ListItemButton
        selected={selectedIndex === 0}
        onClick={() => handleListItemClick(0, 'cambiopassword')}
      >
        <ListItemIcon>
          <KeyOutlined />
        </ListItemIcon>
        <ListItemText primary="Cambio password" />
      </ListItemButton>

      <ListItemButton selected={selectedIndex === 2} onClick={handleLogout}>
        <ListItemIcon>
          <LogoutOutlined />
        </ListItemIcon>
        <ListItemText primary="Logout" />
      </ListItemButton>
    </List>
  )
}
