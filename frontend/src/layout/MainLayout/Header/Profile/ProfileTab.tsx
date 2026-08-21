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

  const handleLogout = async () => {
    setSelectedIndex(1)
    // The success toast and the redirect used to fire OUTSIDE this promise,
    // with the failure going only to console.error — so an offline or
    // restarting backend produced a green "logged out" over a Django session
    // cookie that was still valid. Pressing Back, or opening any app URL,
    // re-authenticated through ProtectedRoute straight back into the account.
    // On a shared workstation that is the next person landing in the previous
    // one's data, which is what this waits for the answer before claiming.
    let serverSessionEnded = true
    try {
      await fetchApi({ url: endpoints.auth.logout, method: MethodHTTP.POST })
    } catch (error: unknown) {
      console.error('Server logout failed:', error)
      serverSessionEnded = false
    }

    // Local state and the redirect happen either way: leaving someone stuck on
    // an authenticated screen because the network is down would be worse, and
    // is not what they asked for.
    removeFromLocalStorage(LocalStorageKey.USER)
    if (serverSessionEnded) {
      toast.success(MessageText.logoutSuccess)
    } else {
      toast.warning(MessageText.logoutServerUnreachable)
    }
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

      <MenuItem
        selected={selectedIndex === 1}
        onClick={() => void handleLogout()}
      >
        <ListItemIcon sx={{ minWidth: 32, color: theme.palette.slate[500] }}>
          <LogOut size={16} />
        </ListItemIcon>
        <ListItemText primary="Logout" />
      </MenuItem>
    </>
  )
}
