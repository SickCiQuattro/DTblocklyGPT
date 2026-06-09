import React, { useRef, useState } from 'react'
import {
  useTheme,
  Avatar,
  Box,
  ButtonBase,
  CardContent,
  ClickAwayListener,
  Direction,
  Grid,
  Paper,
  Popper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material'
import { User } from 'lucide-react'

import { MainCard } from 'components/MainCard'
import { Transitions } from 'components/Transitions'
import { getFromLocalStorage, LocalStorageKey } from 'utils/localStorageUtils'
import { RandomUserIcon } from 'assets/robots'
import { UserLoginInterface } from 'pages/login/LoginForm'

import { ProfileTab } from './ProfileTab'

interface TabPanelProps {
  children?: React.ReactNode
  index: any
  value: any
  dir: Direction
}

const TabPanel = ({ children = null, value, index, dir }: TabPanelProps) => (
  <div
    role="tabpanel"
    hidden={value !== index}
    id={`profile-tabpanel-${index}`}
    aria-labelledby={`profile-tab-${index}`}
    dir={dir}
  >
    {value === index && children}
  </div>
)

interface ProfileProps {
  drawerOpen?: boolean
}

export const Profile = ({ drawerOpen = true }: ProfileProps) => {
  const theme = useTheme()
  const storedUser = getFromLocalStorage(LocalStorageKey.USER) as
    | Partial<UserLoginInterface>
    | ''
  const userName =
    typeof storedUser === 'object' && storedUser !== null
      ? storedUser.username || ''
      : ''
  const userGroup =
    typeof storedUser === 'object' && storedUser !== null
      ? storedUser.group || ''
      : ''

  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState<boolean>(false)
  const handleToggle = () => {
    setOpen((prevOpen) => !prevOpen)
  }

  const handleClose = (event: MouseEvent | TouchEvent) => {
    if (
      anchorRef.current &&
      event.target instanceof Node &&
      anchorRef.current.contains(event.target)
    ) {
      return
    }
    setOpen(false)
  }

  const [value, setValue] = useState(0)

  const handleChange = (_event: React.SyntheticEvent, newValue: number) => {
    setValue(newValue)
  }

  const iconBackColorOpen = 'grey.300'

  return (
    <Box sx={{ flexShrink: 0, ml: 0, width: '100%' }}>
      <ButtonBase
        sx={{
          p: 0.5,
          bgcolor: open ? iconBackColorOpen : 'transparent',
          borderRadius: 1,
          '&:hover': { bgcolor: 'secondary.lighter' },
          width: '100%',
        }}
        aria-label="open profile"
        ref={anchorRef}
        aria-controls={open ? 'profile-grow' : undefined}
        aria-haspopup="true"
        onClick={handleToggle}
        title="Open profile menu"
      >
        <Stack
          direction="row"
          spacing={0}
          sx={{
            alignItems: 'center',
            justifyContent: 'flex-start',
            width: '100%',
          }}
        >
          <Avatar
            alt="user profile"
            sx={{ width: 32, height: 32, flexShrink: 0 }}
          >
            <RandomUserIcon />
          </Avatar>
          <Typography
            variant="subtitle1"
            sx={{
              margin: 0,
              ml: drawerOpen ? 1.5 : 0,
              opacity: drawerOpen ? 1 : 0,
              maxWidth: drawerOpen ? '140px' : '0px',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              transition:
                'opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), max-width 0.2s cubic-bezier(0.4, 0, 0.2, 1), margin-left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            {userName}
          </Typography>
        </Stack>
      </ButtonBase>
      <Popper
        placement={drawerOpen ? 'bottom-start' : 'right-end'}
        open={open}
        anchorEl={anchorRef.current}
        role={undefined}
        transition
        disablePortal
        popperOptions={{
          modifiers: [{ name: 'offset', options: { offset: [0, 9] } }],
        }}
      >
        {({ TransitionProps }) => (
          <Transitions type="fade" in={open} {...TransitionProps}>
            {open && (
              <Paper
                sx={{
                  boxShadow: theme.shadows[1],
                  width: 290,
                  minWidth: 240,
                  maxWidth: 290,
                  [theme.breakpoints.down('md')]: { maxWidth: 250 },
                }}
              >
                <ClickAwayListener onClickAway={handleClose}>
                  <MainCard elevation={0} border={false} content={false}>
                    <CardContent sx={{ px: 2.5, pt: 3 }}>
                      <Grid
                        container
                        sx={{
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <Grid>
                          <Stack
                            direction="row"
                            spacing={1.25}
                            sx={{ alignItems: 'center' }}
                          >
                            <Avatar
                              alt="profile user"
                              sx={{ width: 32, height: 32 }}
                            >
                              <RandomUserIcon />
                            </Avatar>
                            <Stack>
                              <Typography variant="h6">{userName}</Typography>
                              <Typography variant="body2" color="textSecondary">
                                {userGroup}
                              </Typography>
                            </Stack>
                          </Stack>
                        </Grid>
                      </Grid>
                    </CardContent>
                    {open && (
                      <>
                        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                          <Tabs
                            variant="fullWidth"
                            value={value}
                            onChange={handleChange}
                            aria-label="profile tabs"
                          >
                            <Tab
                              sx={{
                                display: 'flex',
                                flexDirection: 'row',
                                justifyContent: 'center',
                                alignItems: 'center',
                                textTransform: 'capitalize',
                                cursor: 'default',
                              }}
                              icon={
                                <User
                                  size={16}
                                  style={{
                                    marginBottom: 0,
                                    marginRight: '10px',
                                  }}
                                />
                              }
                              label="Profile"
                              id="profile-tab-0"
                              aria-controls="profile-tabpanel-0"
                            />
                          </Tabs>
                        </Box>
                        <TabPanel value={value} index={0} dir={theme.direction}>
                          <ProfileTab setOpen={setOpen} />
                        </TabPanel>
                      </>
                    )}
                  </MainCard>
                </ClickAwayListener>
              </Paper>
            )}
          </Transitions>
        )}
      </Popper>
    </Box>
  )
}
