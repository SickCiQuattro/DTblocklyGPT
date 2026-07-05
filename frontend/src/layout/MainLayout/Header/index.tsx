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
} from '@mui/material'
import AppBar from '@mui/material/AppBar'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Save,
  Pencil,
  MessageSquare,
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
import { SegmentedControl } from 'components/SegmentedControl'
import { KeycapHint, modKey } from 'components/KeycapHint'
import { ConfirmDeleteDialog } from 'features/blockly/editor/dialogs/ConfirmDeleteDialog'
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

  // Digital Twin / Copilot are independent toggles, modeled as one
  // non-exclusive SegmentedControl instead of two separate outlined buttons.
  const segmentValues = [
    ...(simOpen ? ['twin'] : []),
    ...(chatOpen ? ['copilot'] : []),
  ]
  const handleSegmentChange = (
    _event: React.MouseEvent<HTMLElement>,
    newValue: string[],
  ) => {
    if (newValue.includes('twin') !== simOpen) dispatch(toggleSim())
    if (newValue.includes('copilot') !== chatOpen) dispatch(toggleChat())
  }

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
        <SegmentedControl
          value={segmentValues}
          onChange={handleSegmentChange}
          options={[
            {
              value: 'twin',
              label: 'Digital Twin',
              icon: <PanelRight size={14} />,
            },
            {
              value: 'copilot',
              label: 'Copilot',
              icon: <MessageSquare size={14} />,
            },
          ]}
        />
        {activeTaskStatus === 'published_with_draft' && (
          <Button
            variant="text"
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
            onClick={() => setDiscardConfirmOpen(true)}
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
              : alpha(theme.palette.primary.main, 0.2),
            color: workspaceReady ? 'common.white' : 'primary.main',
            bgcolor: workspaceReady ? 'success.main' : 'transparent',
            boxShadow: 'none',
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              boxShadow: 'none',
              borderColor: workspaceReady ? 'success.dark' : 'primary.main',
              bgcolor: workspaceReady
                ? 'success.dark'
                : alpha(theme.palette.primary.main, 0.04),
            },
            '&.Mui-disabled': {
              color: workspaceReady ? 'common.white' : 'primary.main',
              bgcolor: workspaceReady ? 'success.main' : 'transparent',
              borderColor: workspaceReady
                ? 'transparent'
                : alpha(theme.palette.primary.main, 0.2),
              opacity: 0.7,
              cursor: 'not-allowed',
            },
          }}
        >
          {workspaceReady ? 'Save' : 'Save draft'}
        </Button>
        <KeycapHint>{modKey()}S</KeycapHint>
        <ConfirmDeleteDialog
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
