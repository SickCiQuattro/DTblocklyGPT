import React from 'react'
import { useTheme } from '@mui/material/styles'
import {
  IconButton,
  Toolbar,
  useMediaQuery,
  Typography,
  InputBase,
  Button,
  CircularProgress,
} from '@mui/material'
import AppBar from '@mui/material/AppBar'
import { useLocation } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Save,
  Pencil,
  MessageSquare,
  Send,
  RotateCcw,
} from 'lucide-react'

import { useAppSelector } from 'store/reducers'
import {
  setTaskName,
  toggleSim,
  triggerSave,
  triggerDiscard,
  toggleChat,
} from 'store/reducers/task'
import { Profile } from 'layout/MainLayout/Header/Profile'
import { LogoSection } from 'components/Logo'
import { TaskStatusChip } from 'components/TaskStatusChip'
import { drawerWidth } from 'utils/constants'

interface HeaderProps {
  open: boolean
  handleDrawerToggle: () => void
}

export const Header = ({ open, handleDrawerToggle }: HeaderProps) => {
  const theme = useTheme()
  const matchDownLG = useMediaQuery(theme.breakpoints.down('lg'))
  const location = useLocation()
  const dispatch = useDispatch()

  const isIDERoute = location.pathname.startsWith('/task/')

  const activeTaskName = useAppSelector((state) => state.task.activeTaskName)
  const activeTaskStatus = useAppSelector(
    (state) => state.task.activeTaskStatus,
  )
  const isSaving = useAppSelector((state) => state.task.isSaving)
  const simOpen = useAppSelector((state) => state.task.simOpen)
  const chatOpen = useAppSelector((state) => state.task.chatOpen)
  const workspaceReady = useAppSelector((state) => state.task.workspaceReady)

  const [isEditing, setIsEditing] = React.useState(false)
  const [localName, setLocalName] = React.useState(activeTaskName)

  React.useEffect(() => {
    setLocalName(activeTaskName)
  }, [activeTaskName])

  const handleSaveName = () => {
    setIsEditing(false)
    if (localName.trim() && localName !== activeTaskName) {
      dispatch(setTaskName(localName.trim()))
      dispatch(triggerSave(true))
    }
  }

  const iconBackColor = 'grey.100'
  const iconBackColorOpen = 'grey.200'

  const statusChip = <TaskStatusChip status={activeTaskStatus} />

  const mainHeader = isIDERoute ? (
    <Toolbar sx={{ justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {isEditing ? (
            <InputBase
              value={localName}
              onChange={(e) => setLocalName(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveName()
              }}
              autoFocus
              sx={{
                fontSize: '1rem',
                fontWeight: 600,
                color: 'text.primary',
                borderBottom: `2px solid ${theme.palette.primary.main}`,
                paddingBottom: '2px',
                width: '180px',
              }}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Typography
                variant="h5"
                sx={{ fontWeight: 600, cursor: 'pointer' }}
                onClick={() => setIsEditing(true)}
              >
                {activeTaskName}
              </Typography>
              <IconButton size="small" onClick={() => setIsEditing(true)}>
                <Pencil size={14} />
              </IconButton>
            </div>
          )}
          {statusChip}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Button
          variant={simOpen ? 'contained' : 'outlined'}
          color="primary"
          size="small"
          startIcon={<PanelRight size={14} />}
          onClick={() => dispatch(toggleSim())}
          title={
            simOpen
              ? 'Hide the Digital Twin panel'
              : 'Show the Digital Twin panel'
          }
          sx={{
            borderRadius: '8px',
            textTransform: 'none',
            fontWeight: 500,
            fontSize: '0.85rem',
            boxShadow: 'none',
            '&:hover': {
              boxShadow: 'none',
            },
          }}
        >
          Digital Twin
        </Button>
        <Button
          variant={chatOpen ? 'contained' : 'outlined'}
          color="secondary"
          size="small"
          startIcon={<MessageSquare size={14} />}
          onClick={() => dispatch(toggleChat())}
          sx={{
            borderRadius: '8px',
            textTransform: 'none',
            fontWeight: 500,
            fontSize: '0.85rem',
            borderColor: chatOpen ? 'transparent' : 'rgba(99, 102, 241, 0.2)',
            color: chatOpen ? '#FFFFFF' : 'primary.main',
            bgcolor: chatOpen ? 'primary.main' : 'transparent',
            boxShadow: 'none',
            '&:hover': {
              boxShadow: 'none',
              borderColor: 'primary.main',
              bgcolor: chatOpen ? 'primary.dark' : 'rgba(99, 102, 241, 0.04)',
            },
          }}
        >
          Copilot
        </Button>
        {activeTaskStatus === 'published_with_draft' && (
          <Button
            variant="outlined"
            color="error"
            size="small"
            startIcon={
              isSaving ? (
                <CircularProgress size={14} color="inherit" />
              ) : (
                <RotateCcw size={14} />
              )
            }
            disabled={isSaving}
            onClick={() => dispatch(triggerDiscard(true))}
            sx={{
              borderRadius: '8px',
              textTransform: 'none',
              fontWeight: 500,
              fontSize: '0.85rem',
            }}
          >
            Discard draft
          </Button>
        )}
        <Button
          variant={workspaceReady ? 'contained' : 'outlined'}
          color={workspaceReady ? 'success' : 'primary'}
          size="small"
          startIcon={
            isSaving ? (
              <CircularProgress size={14} color="inherit" />
            ) : (
              <Save size={14} />
            )
          }
          disabled={isSaving}
          onClick={() => dispatch(triggerSave(true))}
          sx={{
            width: '120px',
            borderRadius: '8px',
            textTransform: 'none',
            fontWeight: 500,
            fontSize: '0.85rem',
            borderColor: workspaceReady
              ? 'transparent'
              : 'rgba(99, 102, 241, 0.2)',
            color: workspaceReady ? '#FFFFFF' : 'primary.main',
            bgcolor: workspaceReady ? 'success.main' : 'transparent',
            boxShadow: 'none',
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              boxShadow: 'none',
              borderColor: workspaceReady ? 'success.dark' : 'primary.main',
              bgcolor: workspaceReady
                ? 'success.dark'
                : 'rgba(99, 102, 241, 0.04)',
            },
            '&.Mui-disabled': {
              color: workspaceReady ? '#FFFFFF' : 'primary.main',
              bgcolor: workspaceReady ? 'success.main' : 'transparent',
              borderColor: workspaceReady
                ? 'transparent'
                : 'rgba(99, 102, 241, 0.2)',
              opacity: 0.7,
              cursor: 'not-allowed',
            },
          }}
        >
          {workspaceReady ? 'Save' : 'Save draft'}
        </Button>
      </div>
    </Toolbar>
  ) : (
    <Toolbar sx={{ justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <IconButton
          disableRipple
          aria-label="open drawer"
          onClick={handleDrawerToggle}
          edge="start"
          color="secondary"
          sx={{
            color: 'text.primary',
            bgcolor: open ? iconBackColorOpen : iconBackColor,
            ml: { xs: 0, lg: -2 },
          }}
        >
          {!open ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
        </IconButton>
      </div>
    </Toolbar>
  )

  return !matchDownLG ? (
    <AppBar
      position="fixed"
      color="inherit"
      elevation={0}
      sx={{
        borderBottom: `1px solid ${theme.palette.divider}`,
        zIndex: theme.zIndex.drawer + 1,
        marginLeft: '56px',
        width: 'calc(100% - 56px)',
        transition: theme.transitions.create(['width', 'margin'], {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.leavingScreen,
        }),
        ...(open && {
          marginLeft: `${drawerWidth}px`,
          width: `calc(100% - ${drawerWidth}px)`,
          transition: theme.transitions.create(['width', 'margin'], {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.enteringScreen,
          }),
        }),
      }}
    >
      {mainHeader}
    </AppBar>
  ) : (
    <AppBar
      position="fixed"
      color="inherit"
      elevation={0}
      sx={{ borderBottom: `1px solid ${theme.palette.divider}` }}
    >
      {mainHeader}
    </AppBar>
  )
}
