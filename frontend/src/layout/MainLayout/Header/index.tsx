import React from 'react'
import { alpha, useTheme } from '@mui/material/styles'
import {
  IconButton,
  Toolbar,
  useMediaQuery,
  Typography,
  InputBase,
  Button,
  CircularProgress,
  Tooltip,
} from '@mui/material'
import AppBar from '@mui/material/AppBar'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import {
  PanelLeft,
  Save,
  Pencil,
  MessageSquare,
  Play,
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
import { TaskStatusChip } from 'components/TaskStatusChip'
import { modKey } from 'components/KeycapHint'
import { ConfirmDialog } from 'components/ConfirmDialog'
import { drawerWidth } from 'utils/constants'
import {
  RAIL_CLOSED_WIDTH,
  railTransition,
} from 'layout/MainLayout/Drawer/MiniDrawerStyled'

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

  // Exactly one of Save/Run is ever the filled (primary) button. Run only
  // takes over once there is truly nothing left to do: the task is already
  // published AND the live workspace still passes conformance (activeTaskStatus
  // only updates after a save round-trip, so workspaceReady catches the case
  // where the user broke a block on an already-published task).
  const isRunPrimary = activeTaskStatus === 'published' && workspaceReady

  const [isEditing, setIsEditing] = React.useState(false)
  const [localName, setLocalName] = React.useState(activeTaskName)
  const [discardConfirmOpen, setDiscardConfirmOpen] = React.useState(false)

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Typography
            component={RouterLink}
            to="/tasks"
            variant="body2"
            sx={{
              color: 'text.secondary',
              fontWeight: 500,
              textDecoration: 'none',
              '&:hover': { color: 'primary.main' },
            }}
          >
            Tasks
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.disabled' }}>
            ›
          </Typography>
        </div>
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
                component="h1"
                sx={{ fontWeight: 600, cursor: 'pointer' }}
                onClick={() => setIsEditing(true)}
              >
                {activeTaskName}
              </Typography>
              <IconButton
                size="small"
                onClick={() => setIsEditing(true)}
                aria-label="Rename task"
                title="Rename task"
              >
                <Pencil size={14} />
              </IconButton>
            </div>
          )}
          {statusChip}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Tooltip title={chatOpen ? 'Close Copilot' : 'Ask Copilot for help'}>
          <Button
            variant="text"
            size="small"
            onClick={() => dispatch(toggleChat())}
            aria-label={chatOpen ? 'Close Copilot' : 'Open Copilot'}
            startIcon={<MessageSquare size={16} />}
            sx={{
              height: theme.spacing(3.75),
              borderRadius: '8px',
              textTransform: 'none',
              fontWeight: 500,
              fontSize: '0.85rem',
              color: chatOpen ? 'primary.main' : 'text.secondary',
              bgcolor: chatOpen
                ? alpha(theme.palette.primary.main, 0.08)
                : 'transparent',
              '&:hover': {
                bgcolor: alpha(theme.palette.primary.main, 0.08),
              },
            }}
          >
            Copilot
          </Button>
        </Tooltip>
        {activeTaskStatus === 'published_with_draft' && (
          <Button
            variant="text"
            size="small"
            startIcon={
              isSaving ? (
                <CircularProgress size={14} color="inherit" />
              ) : (
                <RotateCcw size={14} />
              )
            }
            disabled={isSaving}
            onClick={() => setDiscardConfirmOpen(true)}
            sx={{
              height: theme.spacing(3.75),
              borderRadius: '8px',
              textTransform: 'none',
              fontWeight: 500,
              fontSize: '0.85rem',
              color: 'error.darker',
              '&:hover': {
                bgcolor: alpha(theme.palette.error.main, 0.08),
              },
            }}
          >
            Discard draft
          </Button>
        )}
        <Tooltip
          title={`${workspaceReady ? 'Save & Publish' : 'Save draft'} (${modKey()}S)`}
        >
          <Button
            variant={isRunPrimary ? 'outlined' : 'contained'}
            color="primary"
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
              height: theme.spacing(3.75),
              minWidth: '120px',
              px: 2,
              borderRadius: '8px',
              textTransform: 'none',
              fontWeight: 500,
              fontSize: '0.85rem',
              boxShadow: 'none',
              ...(isRunPrimary && {
                borderColor: alpha(theme.palette.primary.dark, 0.5),
                color: 'primary.dark',
              }),
              '&:hover': {
                boxShadow: 'none',
                ...(isRunPrimary && {
                  borderColor: 'primary.dark',
                  bgcolor: alpha(theme.palette.primary.main, 0.04),
                }),
              },
              '&.Mui-disabled': {
                opacity: 0.7,
                cursor: 'not-allowed',
              },
            }}
          >
            {workspaceReady ? 'Save & Publish' : 'Save draft'}
          </Button>
        </Tooltip>
        <Tooltip title="Open the robot panel to simulate or run">
          <Button
            variant={isRunPrimary ? 'contained' : 'outlined'}
            color="primary"
            size="small"
            startIcon={<Play size={14} />}
            onClick={() => {
              if (!simOpen) dispatch(toggleSim())
            }}
            sx={{
              height: theme.spacing(3.75),
              borderRadius: '8px',
              textTransform: 'none',
              fontWeight: 500,
              fontSize: '0.85rem',
              boxShadow: 'none',
              ...(!isRunPrimary && {
                borderColor: alpha(theme.palette.primary.dark, 0.5),
                color: 'primary.dark',
              }),
              '&:hover': {
                boxShadow: 'none',
                ...(!isRunPrimary && {
                  borderColor: 'primary.dark',
                  bgcolor: alpha(theme.palette.primary.main, 0.04),
                }),
              },
            }}
          >
            Run
          </Button>
        </Tooltip>
        <ConfirmDialog
          open={discardConfirmOpen}
          message="Discard this draft? Your unpublished changes will be lost and the task will revert to its last published version."
          confirmLabel="Discard"
          onConfirm={() => {
            setDiscardConfirmOpen(false)
            dispatch(triggerDiscard(true))
          }}
          onCancel={() => setDiscardConfirmOpen(false)}
        />
      </div>
    </Toolbar>
  ) : (
    <Toolbar sx={{ justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <Tooltip title={open ? 'Collapse sidebar' : 'Expand sidebar'}>
          <IconButton
            disableRipple
            aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
            onClick={handleDrawerToggle}
            edge="start"
            color="secondary"
            sx={{
              color: 'text.primary',
              bgcolor: open ? iconBackColorOpen : iconBackColor,
              ml: { xs: 0, lg: -2 },
            }}
          >
            <PanelLeft size={20} />
          </IconButton>
        </Tooltip>
      </div>
    </Toolbar>
  )

  return !matchDownLG ? (
    <AppBar
      position="fixed"
      color="inherit"
      elevation={0}
      sx={{
        bgcolor: 'background.default',
        zIndex: theme.zIndex.drawer + 1,
        marginLeft: `${RAIL_CLOSED_WIDTH}px`,
        width: `calc(100% - ${RAIL_CLOSED_WIDTH}px)`,
        transition: railTransition(theme, ['width', 'margin']),
        ...(open && {
          marginLeft: `${drawerWidth}px`,
          width: `calc(100% - ${drawerWidth}px)`,
          transition: railTransition(theme, ['width', 'margin']),
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
      sx={{ bgcolor: 'background.default' }}
    >
      {mainHeader}
    </AppBar>
  )
}
