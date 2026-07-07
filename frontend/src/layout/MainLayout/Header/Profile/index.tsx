import { useRef, useState } from 'react'
import { alpha, useTheme } from '@mui/material/styles'
import {
  Avatar,
  Box,
  ButtonBase,
  Divider,
  Menu,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'

import { NAV_ROW_HEIGHT } from 'layout/MainLayout/Drawer/DrawerContent/Navigation/NavItem'
import { getFromLocalStorage, LocalStorageKey } from 'utils/localStorageUtils'
import { RandomUserIcon } from 'assets/robots'
import { UserLoginInterface } from 'pages/login/LoginForm'

import { ProfileTab } from './ProfileTab'

interface ProfileProps {
  drawerOpen?: boolean
}

export const Profile = ({ drawerOpen = true }: ProfileProps) => {
  const theme = useTheme()
  const primary = theme.palette.primary.main
  const storedUser = getFromLocalStorage(LocalStorageKey.USER) as
    Partial<UserLoginInterface> | ''
  const userName =
    typeof storedUser === 'object' && storedUser !== null
      ? storedUser.username || ''
      : ''
  const userGroup =
    typeof storedUser === 'object' && storedUser !== null
      ? storedUser.group || ''
      : ''

  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)

  return (
    <Box sx={{ flexShrink: 0, width: '100%' }}>
      <Tooltip
        title="Profile"
        placement="right"
        disableHoverListener={drawerOpen}
      >
        <ButtonBase
          ref={anchorRef}
          onClick={() => setOpen((prev) => !prev)}
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={open ? 'profile-menu' : undefined}
          aria-label="Open profile menu"
          sx={{
            width: '100%',
            minHeight: NAV_ROW_HEIGHT,
            borderRadius: '8px',
            pl: '6px',
            pr: 1,
            display: 'flex',
            justifyContent: 'flex-start',
            alignItems: 'center',
            bgcolor: open ? alpha(primary, 0.08) : 'transparent',
            transition: 'background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            '&:hover': { bgcolor: alpha(primary, 0.04) },
          }}
        >
          <Avatar
            alt="user profile"
            sx={{ width: 32, height: 32, flexShrink: 0 }}
          >
            <RandomUserIcon />
          </Avatar>
          <Typography
            variant="body2"
            sx={{
              ml: drawerOpen ? '8px' : 0,
              opacity: drawerOpen ? 1 : 0,
              maxWidth: drawerOpen ? '140px' : '0px',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontWeight: 500,
              color: 'text.primary',
              transition:
                'opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), max-width 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            {userName}
          </Typography>
        </ButtonBase>
      </Tooltip>

      <Menu
        id="profile-menu"
        anchorEl={anchorRef.current}
        open={open}
        onClose={() => setOpen(false)}
        anchorOrigin={
          drawerOpen
            ? { vertical: 'top', horizontal: 'left' }
            : { vertical: 'center', horizontal: 'right' }
        }
        transformOrigin={
          drawerOpen
            ? { vertical: 'bottom', horizontal: 'left' }
            : { vertical: 'center', horizontal: 'left' }
        }
        slotProps={{
          paper: {
            sx: {
              mt: drawerOpen ? '-8px' : 0,
              ml: drawerOpen ? 0 : '8px',
              width: 260,
              // Same elevation language as every other editor/app popover —
              // see features/blockly/editor/menuStyles.ts MENU_PAPER_SX.
              borderRadius: '12px',
              border: `1px solid ${theme.palette.slate[200]}`,
              boxShadow: '0 12px 28px rgba(15, 23, 42, 0.12)',
            },
          },
        }}
      >
        <Box sx={{ px: 2, py: 1.5 }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <Avatar alt="profile user" sx={{ width: 32, height: 32 }}>
              <RandomUserIcon />
            </Avatar>
            <Stack sx={{ minWidth: 0 }}>
              <Typography
                variant="subtitle2"
                noWrap
                sx={{ color: theme.palette.slate[900], fontWeight: 600 }}
              >
                {userName}
              </Typography>
              <Typography
                variant="caption"
                noWrap
                sx={{ color: theme.palette.slate[500] }}
              >
                {userGroup}
              </Typography>
            </Stack>
          </Stack>
        </Box>
        <Divider />
        <ProfileTab setOpen={setOpen} />
      </Menu>
    </Box>
  )
}
