import { useState } from 'react'
import { useTheme } from '@mui/material/styles'
import { ListItemIcon, ListItemText, MenuItem } from '@mui/material'
import { Key, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'

import {
  LocalStorageKey,
  removeFromLocalStorage,
} from 'utils/localStorageUtils'
import { MessageText } from 'utils/messages'
import { endpoints } from 'services/endpoints'
import { MethodHTTP, fetchApi } from 'services/api'

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
    // This only ever cleared localStorage — the Django session cookie
    // (sessionid/csrftoken) survived, so "logged out" was local-only. The
    // backend endpoint for this already exists and was just never called.
    // Best-effort: local state clears and the redirect happens either way,
    // even if the request itself fails (e.g. offline).
    fetchApi({ url: endpoints.auth.logout, method: MethodHTTP.POST }).catch(
      (error: unknown) => {
        console.error('Server logout failed:', error)
      },
    )
    removeFromLocalStorage(LocalStorageKey.USER)
    toast.success(MessageText.logoutSuccess)
    setOpen?.(false)
    void navigate('/login')
  }

  return (
    <>
      <MenuItem selected={selectedIndex === 0} onClick={handleChangePassword}>
        <ListItemIcon sx={{ minWidth: 32, color: theme.palette.slate[500] }}>
          <Key size={16} />
        </ListItemIcon>
        <ListItemText primary="Change password" />
      </MenuItem>

      <MenuItem selected={selectedIndex === 1} onClick={handleLogout}>
        <ListItemIcon sx={{ minWidth: 32, color: theme.palette.slate[500] }}>
          <LogOut size={16} />
        </ListItemIcon>
        <ListItemText primary="Logout" />
      </MenuItem>
    </>
  )
}
