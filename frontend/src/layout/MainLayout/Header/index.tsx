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
  Popover,
  Stack,
  Box,
  Alert,
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
  AlertTriangle,
} from 'lucide-react'

import { useAppSelector } from 'store/reducers'
import {
  setTaskName,
  toggleSim,
  triggerSave,
  triggerRename,
  triggerDiscard,
  toggleChat,
} from 'store/reducers/task'
import { TaskStatusChip } from 'components/TaskStatusChip'
import { modKey } from 'components/KeycapHint'
import { ConfirmDialog } from 'components/ConfirmDialog'
import { drawerWidth } from 'utils/constants'
import { UI_TEXT } from 'constants/uiVocabulary'
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
  const isDiscarding = useAppSelector((state) => state.task.isDiscarding)
  const simOpen = useAppSelector((state) => state.task.simOpen)
  const chatOpen = useAppSelector((state) => state.task.chatOpen)
  const workspaceReady = useAppSelector((state) => state.task.workspaceReady)
  const conformanceIssues = useAppSelector(
    (state) => state.task.conformanceIssues,
  )
  const hasUnsavedEdits = useAppSelector((state) => state.task.hasUnsavedEdits)
  const isReadOnly = useAppSelector((state) => state.task.isReadOnly)
  const ownerUsername = useAppSelector((state) => state.task.ownerUsername)
  const [issuesAnchorEl, setIssuesAnchorEl] =
    React.useState<HTMLElement | null>(null)

  // Exactly one of Save/Run is ever the filled (primary) button. Run only
  // takes over once there is truly nothing left to do: the task is already
  // published AND the live workspace still passes conformance (activeTaskStatus
  // only updates after a save round-trip, so workspaceReady catches the case
  // where the user broke a block on an already-published task) AND there's no
  // edit still sitting in the autosave debounce — without hasUnsavedEdits,
  // Run stayed primary for up to the 2s (or longer, edit-dependent) gap
  // between a real edit and the autosave that actually publishes it, and
  // clicking it during that gap ran the stale published version while the
  // screen showed the new one.
  const isRunPrimary =
    activeTaskStatus === 'published' && workspaceReady && !hasUnsavedEdits

  const [isEditing, setIsEditing] = React.useState(false)
  const [localName, setLocalName] = React.useState(activeTaskName)
  const [discardConfirmOpen, setDiscardConfirmOpen] = React.useState(false)
  // Escape sets isEditing false directly (see handleCancelEditName), which
  // unmounts the InputBase — some browsers fire a blur on unmount, which
  // would otherwise re-trigger handleSaveName right after a cancel.
  const skipBlurSaveRef = React.useRef(false)

  React.useEffect(() => {
    setLocalName(activeTaskName)
  }, [activeTaskName])

  // The actual discard happens in task-workspace/index.tsx's
  // discardTriggered listener — auto-close the confirm dialog once THAT
  // finishes, rather than closing it immediately on click, so the loading
  // state below has time to show.
  //
  // Keyed on isDiscarding, not isSaving: isSaving is set by every save path,
  // so the debounced autosave completing behind this dialog closed it on its
  // own. The user saw the confirm dismiss itself — which reads as "done" —
  // while nothing had been discarded and the autosave had in fact just
  // persisted the very changes they were asking to throw away.
  const wasDiscardingRef = React.useRef(false)
  React.useEffect(() => {
    if (wasDiscardingRef.current && !isDiscarding) setDiscardConfirmOpen(false)
    wasDiscardingRef.current = isDiscarding
  }, [isDiscarding])

  const handleSaveName = () => {
    if (skipBlurSaveRef.current) {
      skipBlurSaveRef.current = false
      return
    }
    setIsEditing(false)
    if (localName.trim() && localName !== activeTaskName) {
      dispatch(setTaskName(localName.trim()))
      // Rename-only — must not go through triggerSave, which also
      // (re)publishes the whole workspace when it happens to pass
      // conformance (see store/reducers/task.ts).
      dispatch(triggerRename(true))
    }
  }

  const handleCancelEditName = () => {
    setLocalName(activeTaskName)
    setIsEditing(false)
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
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  skipBlurSaveRef.current = true
                  handleCancelEditName()
                } else if (
                  (e.metaKey || e.ctrlKey) &&
                  (e.key === 's' || e.key === 'S')
                ) {
                  // Commit the in-progress name, then save — rather than
                  // blocking the save while the rename editor is open.
                  // The global Ctrl/Cmd+S (task-workspace/index.tsx) reads
                  // activeTaskName from Redux, which this editor only writes
                  // on blur/Enter, so pressing it mid-rename saved the task
                  // under its previous name and dropped the new one with no
                  // sign it had been ignored. The global handler skips its own
                  // dispatch whenever focus is in a text field, so this is the
                  // only one that fires here — no double save.
                  e.preventDefault()
                  // Both dispatches land in the same React batch, so the save
                  // effect over in task-workspace re-runs already seeing the
                  // new name. No triggerRename: saveTaskToBackend PUTs the
                  // name itself when it differs from the loaded task, and the
                  // rename listener would fire a second, racing PUT for it.
                  const trimmed = localName.trim()
                  if (trimmed && trimmed !== activeTaskName) {
                    dispatch(setTaskName(trimmed))
                  }
                  // Leaving edit mode unmounts the InputBase, and some
                  // browsers fire a blur on unmount — same reason
                  // handleCancelEditName arms this ref (see handleSaveName).
                  skipBlurSaveRef.current = true
                  setIsEditing(false)
                  dispatch(triggerSave(true))
                }
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
                sx={{
                  fontWeight: 600,
                  cursor: 'pointer',
                  // The left group grew a badge + Discard button — an
                  // unbounded long name could now push into the fixed-width
                  // action group instead of just crowding empty space.
                  maxWidth: '320px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                onClick={() => setIsEditing(true)}
                title={activeTaskName}
              >
                {activeTaskName}
              </Typography>
              <Tooltip
                title={
                  isReadOnly
                    ? "Shared by another user — you can't edit this task"
                    : 'Rename task'
                }
              >
                <span>
                  <IconButton
                    size="small"
                    onClick={() => setIsEditing(true)}
                    aria-label="Rename task"
                    disabled={isReadOnly}
                  >
                    <Pencil size={14} />
                  </IconButton>
                </span>
              </Tooltip>
            </div>
          )}
          {statusChip}
          {isReadOnly && (
            <Alert
              severity="info"
              icon={false}
              sx={{
                py: 0,
                px: 1.25,
                height: theme.spacing(3.75),
                alignItems: 'center',
                borderRadius: '8px',
                fontSize: '0.8rem',
                '& .MuiAlert-message': { py: 0 },
              }}
            >
              Shared by {ownerUsername ?? 'another user'} — read-only
            </Alert>
          )}
          {/* Status-linked controls live next to the chip they explain, not
              in the action group — otherwise Copilot/Save/Run shift
              horizontally every time one of these appears (Nielsen: stable
              positions build muscle memory across visits). */}
          {conformanceIssues.length > 0 && (
            <>
              {/* workspaceReady is errors-only (computeConformance's
                  `errors.length === 0`) — conformanceIssues mixes in
                  non-blocking warnings too (e.g. an orphaned/circular macro
                  reference), so the badge must show for those even though
                  Save/Publish isn't actually blocked. Copy/aria-label reflect
                  which case this is instead of always claiming "to fix
                  before publishing". */}
              <Tooltip
                title={
                  workspaceReady
                    ? 'Non-blocking warnings for this task'
                    : "Why this task isn't ready to publish"
                }
              >
                <Button
                  size="small"
                  onClick={(e) => setIssuesAnchorEl(e.currentTarget)}
                  startIcon={<AlertTriangle size={14} />}
                  aria-label={`${conformanceIssues.length} issue${conformanceIssues.length !== 1 ? 's' : ''} ${workspaceReady ? 'to review' : 'to fix before publishing'}`}
                  sx={{
                    height: theme.spacing(3.75),
                    minWidth: 0,
                    borderRadius: '8px',
                    textTransform: 'none',
                    fontWeight: 600,
                    fontSize: '0.8rem',
                    px: 1.25,
                    color: 'warning.darker',
                    bgcolor: 'warning.lighter',
                    border: '1px solid',
                    borderColor: 'warning.light',
                    '&:hover': { bgcolor: 'warning.light' },
                  }}
                >
                  {conformanceIssues.length}
                </Button>
              </Tooltip>
              <Popover
                open={!!issuesAnchorEl}
                anchorEl={issuesAnchorEl}
                onClose={() => setIssuesAnchorEl(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                slotProps={{ paper: { sx: { mt: 0.5, maxWidth: 420 } } }}
              >
                <Stack spacing={1} sx={{ p: 1.5 }}>
                  {conformanceIssues.map((issue, i) => (
                    <Box
                      key={i}
                      sx={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                      }}
                    >
                      <AlertTriangle
                        size={13}
                        style={{
                          flexShrink: 0,
                          marginTop: 2,
                          color: theme.palette.warning.dark,
                        }}
                      />
                      <Typography sx={{ fontSize: '0.8rem' }}>
                        {issue}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              </Popover>
            </>
          )}
          {activeTaskStatus === 'published_with_draft' && (
            <Tooltip
              title={
                isReadOnly
                  ? "Shared by another user — you can't edit this task"
                  : 'Discard the unpublished changes and revert to the last published version'
              }
            >
              <span>
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
                  disabled={isSaving || isReadOnly}
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
                  {UI_TEXT.discardUnpublishedChanges}
                </Button>
              </span>
            </Tooltip>
          )}
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
        <Tooltip
          title={
            isReadOnly
              ? "Shared by another user — you can't edit this task"
              : `${workspaceReady ? 'Save & Publish' : 'Save draft'} (${modKey()}S)`
          }
        >
          <span>
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
              disabled={isSaving || isReadOnly}
              onClick={() => dispatch(triggerSave(true))}
              sx={{
                height: theme.spacing(3.75),
                // Fits "Save & Publish", the longer of the two labels, so
                // Save (and Run beside it) never shifts width when the label
                // swaps with "Save draft".
                minWidth: '160px',
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
          </span>
        </Tooltip>
        <Tooltip
          title={
            simOpen
              ? 'Close the robot panel'
              : 'Open the robot panel to simulate or run'
          }
        >
          <Button
            variant={isRunPrimary ? 'contained' : 'outlined'}
            color="primary"
            size="small"
            startIcon={<Play size={14} />}
            onClick={() => dispatch(toggleSim())}
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
          // isDiscarding, for the same reason the auto-close above uses it: a
          // background autosave firing behind this dialog put it into a
          // loading state describing an operation the user had not started.
          loading={isDiscarding}
          message="Discard these unpublished changes? They'll be lost and the task will revert to its last published version."
          confirmLabel="Discard"
          onConfirm={() => dispatch(triggerDiscard(true))}
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
