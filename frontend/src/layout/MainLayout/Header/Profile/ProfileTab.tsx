import { useState } from 'react'
import { useTheme } from '@mui/material/styles'
import { List, ListItemButton, ListItemIcon, ListItemText } from '@mui/material'
import { Key, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'

import {
  LocalStorageKey,
  removeFromLocalStorage,
} from 'utils/localStorageUtils'
import { MessageText } from 'utils/messages'

interface ProfileTabProps {
  setOpen?: (open: boolean) => void
}

export const ProfileTab = ({ setOpen }: ProfileTabProps) => {
  const theme = useTheme()
  const navigate = useNavigate()

  const [selectedIndex, setSelectedIndex] = useState(-1)

  const handleChangePassword = () => {
    setSelectedIndex(0)
    setOpen?.(false)
    void navigate('/changepassword')
  }

  const handleLogout = () => {
    setSelectedIndex(1)
    removeFromLocalStorage(LocalStorageKey.USER)
    toast.success(MessageText.logoutSuccess)
    setOpen?.(false)
    void navigate('/login')
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
        selected={selectedIndex === 0}
        onClick={handleChangePassword}
      >
        <ListItemIcon>
          <Key size={16} />
        </ListItemIcon>
        <ListItemText primary="Change password" />
      </ListItemButton>

      <ListItemButton selected={selectedIndex === 1} onClick={handleLogout}>
        <ListItemIcon>
          <LogOut size={16} />
        </ListItemIcon>
        <ListItemText primary="Logout" />
      </ListItemButton>
    </List>
  )
}
