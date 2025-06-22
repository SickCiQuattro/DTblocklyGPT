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
import { UserOutlined } from '@ant-design/icons'

import { MainCard } from 'components/MainCard'
import { Transitions } from 'components/Transitions'
import { getFromLocalStorage, LocalStorageKey } from 'utils/localStorageUtils'
import { RandomUserIcon } from 'assets/robots'
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

export const Profile = () => {
  const theme = useTheme()
  const userName = getFromLocalStorage(LocalStorageKey.USER).username
  const userGroup = getFromLocalStorage(LocalStorageKey.USER).group

  const anchorRef = useRef<any>(null)
  const [open, setOpen] = useState<boolean>(false)
  const handleToggle = () => {
    setOpen((prevOpen) => !prevOpen)
  }

  const handleClose = (event: MouseEvent | TouchEvent) => {
    if (anchorRef.current && anchorRef.current.contains(event.target)) {
      return
    }
    setOpen(false)
  }

  const [value, setValue] = useState(0)

  const handleChange = (_event, newValue) => {
    setValue(newValue)
  }

  const iconBackColorOpen = 'grey.300'

  return (
    <Box sx={{ flexShrink: 0, ml: 0.75 }}>
      <ButtonBase
        sx={{
          p: 0.25,
          bgcolor: open ? iconBackColorOpen : 'transparent',
          borderRadius: 1,
          '&:hover': { bgcolor: 'secondary.lighter' },
        }}
        aria-label="open profile"
        ref={anchorRef}
        aria-controls={open ? 'profile-grow' : undefined}
        aria-haspopup="true"
        onClick={handleToggle}
        title="Open profile menu"
      >
        <Stack direction="row" spacing={2} alignItems="center" sx={{ p: 0.5 }}>
          <Avatar alt="user profile" sx={{ width: 32, height: 32 }}>
            <RandomUserIcon />
          </Avatar>
          <Typography variant="subtitle1">{userName}</Typography>
        </Stack>
      </ButtonBase>
      <Popper
        placement="bottom-end"
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
                  boxShadow: (theme as any).customShadows.z1,
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
                        justifyContent="space-between"
                        alignItems="center"
                      >
                        <Grid>
                          <Stack
                            direction="row"
                            spacing={1.25}
                            alignItems="center"
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
                                <UserOutlined
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
