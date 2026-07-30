import React, { useEffect, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { toast } from 'react-toastify'
import { alpha } from '@mui/material/styles'
import {
  Box,
  Button,
  IconButton,
  OutlinedInput,
  InputAdornment,
  Paper,
  Skeleton,
  Stack,
  TablePagination,
  Tooltip,
  Typography,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
} from '@mui/material'
import {
  Eye,
  Play,
  BrainCircuit,
  Plus,
  Search,
  Trash2,
  Share2,
  Lock,
  ListChecks,
  MoreVertical,
  Undo2,
} from 'lucide-react'

import { MainCard } from 'components/MainCard'
import { ConfirmDialog } from 'components/ConfirmDialog'
import { TaskStatusChip } from 'components/TaskStatusChip'
import { SegmentedControl } from 'components/SegmentedControl'
import { KeycapHint, modKey } from 'components/KeycapHint'
import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { activeItem } from 'store/reducers/menu'
import { MessageText } from 'utils/messages'
import { defaultCurrentPage } from 'utils/constants'
import { formatDateTimeShortFrontend } from 'utils/date'
import { getFromLocalStorage, LocalStorageKey } from 'utils/localStorageUtils'
import { MyRobotType } from 'pages/myrobots/types'
import { ObjectListType } from 'pages/objects/types'
import { LocationListType } from 'pages/locations/types'
import { ActionListType } from 'pages/actions/types'
import { UserLoginInterface } from 'pages/login/LoginForm'
import { Theme as ThemeOption } from 'themes/theme'
import { useDocumentTitle } from 'hooks/useDocumentTitle'
import { UI_TEXT } from 'constants/uiVocabulary'

import { TaskType } from './types'
import { AnalyzeTaskModal } from './analyzeTaskModal'

// Menu/status icon colors sourced once from the design-system tokens (these
// render inside several sub-components without direct theme access).
const tokenPalette = ThemeOption()

const CARD_PAGE_SIZE_OPTIONS = [12, 24, 48]
const DEFAULT_CARD_PAGE_SIZE = 12

type StatusFilter = 'all' | 'draft' | 'published'

// A task is "published" for filtering purposes whenever it has a live
// version — published_with_draft still has one, just with edits pending.
const matchesStatusFilter = (
  status: string | undefined,
  filter: StatusFilter,
) => {
  if (filter === 'all') return true
  const s = status?.toLowerCase()
  if (filter === 'published')
    return s === 'published' || s === 'published_with_draft'
  return s === 'draft'
}

// ─── Task Row Actions Overflow Menu ──────────────────────────────────────────

const TaskRowActions = ({
  row,
  canManage,
  handleOpenDetails,
  setAnalyzeModalVisible,
  setAnalyzingTask,
  handleDelete,
  handleDiscard,
  referenceDataError,
}: {
  row: TaskType
  canManage: boolean
  handleOpenDetails: (id: number) => void
  setAnalyzeModalVisible: (v: boolean) => void
  setAnalyzingTask: (t: TaskType) => void
  handleDelete: (id: number) => Promise<unknown>
  handleDiscard: (id: number) => Promise<unknown>
  referenceDataError: boolean
}) => {
  const navigate = useNavigate()
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)
  const open = Boolean(anchorEl)
  const rowStatus = (row as any).status?.toLowerCase()
  const isPublishedWithDraft = rowStatus === 'published_with_draft'
  // published_with_draft still runs (its last published version) — only a
  // task that was never published can't run at all.
  const canRun = rowStatus === 'published' || isPublishedWithDraft

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation()
    setAnchorEl(event.currentTarget)
  }
  const handleClose = () => {
    setAnchorEl(null)
  }

  return (
    <Stack
      direction="row"
      spacing={0.5}
      sx={{ alignItems: 'center' }}
      onClick={(e) => e.stopPropagation()}
    >
      <Tooltip
        title={
          canRun
            ? `${UI_TEXT.simulate} this task`
            : 'This task is a draft — publish it first to run it'
        }
      >
        {/* span wrapper: a disabled IconButton alone won't fire the
            Tooltip's hover events */}
        <span>
          <IconButton
            // Always green, always opens the panel pre-set to Simulate
            // (never Real robot) — a one-click shortcut from the list
            // should never default to moving the physical arm. Matches the
            // robot panel's "green = twin-only" convention
            // (DigitalTwinPanel.tsx Mode selector / Run button).
            sx={{ width: 40, height: 40, color: 'success.dark' }}
            disabled={!canRun}
            onClick={() =>
              navigate(`/task/${row.id}`, {
                state: { autoOpenRobot: true, executionTarget: 'sim' },
              })
            }
            id={`btn-run-task-${row.id}`}
            aria-label={`${UI_TEXT.simulate} this task`}
          >
            <Play size={17} />
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip title="More actions">
        <IconButton
          sx={{ width: 40, height: 40 }}
          onClick={handleClick}
          aria-label="more actions"
        >
          <MoreVertical size={18} />
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        slotProps={{ paper: { sx: { minWidth: '150px' } } }}
      >
        <MenuItem
          onClick={() => {
            handleClose()
            handleOpenDetails(row.id)
          }}
          disabled={!canManage}
          title={
            canManage
              ? undefined
              : "Shared by another user — you can't edit this task"
          }
        >
          <ListItemIcon>
            <Eye size={15} />
          </ListItemIcon>
          <ListItemText
            primary={
              <Typography sx={{ fontSize: '0.85rem' }}>Edit details</Typography>
            }
          />
        </MenuItem>

        <MenuItem
          onClick={() => {
            handleClose()
            if (referenceDataError) {
              toast.error(
                "Couldn't load objects/locations/skills/robots — check for problems needs them and your connection dropped. Try again.",
              )
              return
            }
            setAnalyzeModalVisible(true)
            setAnalyzingTask(row)
          }}
        >
          <ListItemIcon>
            <BrainCircuit size={15} style={{ color: tokenPalette.info.dark }} />
          </ListItemIcon>
          <ListItemText
            primary={
              <Typography sx={{ fontSize: '0.85rem' }}>
                Check for problems
              </Typography>
            }
          />
        </MenuItem>

        {isPublishedWithDraft && (
          <MenuItem
            onClick={(e) => {
              if (!canManage) return
              e.stopPropagation()
              setDiscardConfirmOpen(true)
            }}
            disabled={!canManage}
            title={
              canManage
                ? undefined
                : "Shared by another user — you can't manage this task"
            }
          >
            <ListItemIcon>
              <Undo2 size={15} style={{ color: tokenPalette.warning.dark }} />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography sx={{ fontSize: '0.85rem' }}>
                  {UI_TEXT.discardUnpublishedChanges}
                </Typography>
              }
            />
          </MenuItem>
        )}

        <Divider />

        <MenuItem
          onClick={(e) => {
            if (!canManage) return
            e.stopPropagation()
            setDeleteConfirmOpen(true)
          }}
          disabled={!canManage}
          sx={{ color: 'error.dark' }}
          title={
            canManage
              ? undefined
              : "Shared by another user — you can't delete this task"
          }
        >
          <ListItemIcon>
            <Trash2 size={15} color={tokenPalette.error.dark} />
          </ListItemIcon>
          <ListItemText
            primary={
              <Typography sx={{ fontSize: '0.85rem', color: 'error.dark' }}>
                Delete
              </Typography>
            }
          />
        </MenuItem>
      </Menu>

      <ConfirmDialog
        open={deleteConfirmOpen}
        loading={isDeleting}
        message="Delete this task? This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          setIsDeleting(true)
          // fetchApi (services/api.ts) already toasts on failure and rethrows —
          // .catch() here just absorbs that rejection so it doesn't surface as
          // an unhandled promise rejection; no second toast added.
          void handleDelete(row.id)
            .catch(() => {})
            .finally(() => {
              setIsDeleting(false)
              setDeleteConfirmOpen(false)
              handleClose()
            })
        }}
        onCancel={() => setDeleteConfirmOpen(false)}
      />

      <ConfirmDialog
        open={discardConfirmOpen}
        loading={isDiscarding}
        title={`${UI_TEXT.discardUnpublishedChanges}?`}
        message="They'll be lost and the task will revert to its last published version."
        confirmLabel="Discard"
        onConfirm={() => {
          setIsDiscarding(true)
          void handleDiscard(row.id)
            .catch(() => {})
            .finally(() => {
              setIsDiscarding(false)
              setDiscardConfirmOpen(false)
              handleClose()
            })
        }}
        onCancel={() => setDiscardConfirmOpen(false)}
      />
    </Stack>
  )
}

// ─── Task card ────────────────────────────────────────────────────────────────

const TaskCard = ({
  row,
  canManage,
  onOpen,
  ...actionProps
}: {
  row: TaskType
  canManage: boolean
  onOpen: () => void
} & Omit<React.ComponentProps<typeof TaskRowActions>, 'row' | 'canManage'>) => (
  <Tooltip
    title={canManage ? '' : 'Shared by another user — you can’t open this task'}
    disableHoverListener={canManage}
  >
    <Paper
      variant="outlined"
      tabIndex={canManage ? 0 : -1}
      role="button"
      aria-label={
        canManage
          ? `Open ${row.name} workspace`
          : `${row.name} — shared by another user, read only`
      }
      onClick={() => canManage && onOpen()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && canManage) {
          e.preventDefault()
          onOpen()
        }
      }}
      sx={{
        p: 2,
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        cursor: canManage ? 'pointer' : 'default',
        opacity: canManage ? 1 : 0.72,
        boxShadow: (theme) => theme.customShadows.card,
        '@media (prefers-reduced-motion: no-preference)': {
          // Keep the card on its own compositing layer at rest too — without
          // this, the hover-only `transform` promotes it to a layer only on
          // hover, and Chromium re-rasterizes the outlined border with
          // different anti-aliasing, making the (already-present) top border
          // suddenly look like a new line popping in.
          willChange: 'transform',
          transition: 'transform 0.2s ease',
          '&:hover': { transform: 'translateY(-2px)' },
        },
      }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            sx={{
              fontWeight: 600,
              fontSize: '0.9rem',
              color: 'text.primary',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.name}
          </Typography>
          {row.description && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {row.description}
            </Typography>
          )}
        </Box>
        <Tooltip title={row.shared ? 'Shared with other users' : 'Private'}>
          <Stack
            direction="row"
            spacing={0.5}
            sx={{
              alignItems: 'center',
              flexShrink: 0,
              px: 1,
              py: 0.25,
              borderRadius: '999px',
              border: '1px solid',
              borderColor: row.shared
                ? alpha(tokenPalette.success.main, 0.3)
                : 'divider',
              bgcolor: row.shared
                ? alpha(tokenPalette.success.main, 0.08)
                : 'transparent',
            }}
          >
            {row.shared ? (
              <Share2 size={13} color={tokenPalette.success.darker} />
            ) : (
              <Lock size={13} color={tokenPalette.slate[500]} />
            )}
            <Typography
              sx={{
                fontSize: '0.68rem',
                fontWeight: 600,
                color: row.shared
                  ? tokenPalette.success.darker
                  : tokenPalette.slate[500],
              }}
            >
              {row.shared ? 'Shared' : 'Private'}
            </Typography>
          </Stack>
        </Tooltip>
      </Stack>

      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <TaskStatusChip status={(row as any).status} />
        <Typography variant="caption" color="text.secondary">
          Modified {formatDateTimeShortFrontend(row.last_modified)}
        </Typography>
      </Stack>

      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: 'flex-end',
          mt: 'auto',
          pt: 1,
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        <TaskRowActions row={row} canManage={canManage} {...actionProps} />
      </Stack>
    </Paper>
  </Tooltip>
)

// ─── Component ────────────────────────────────────────────────────────────────

const ListTasks = () => {
  useDocumentTitle('Tasks')
  const [page, setPage] = useState(defaultCurrentPage - 1) // MUI is 0-indexed
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_CARD_PAGE_SIZE)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const searchInputRef = useRef<HTMLInputElement>(null)

  // ⌘K/Ctrl+K jumps to the search field, mirroring the same shortcut inside
  // the task workspace (BlocklyEditor.tsx) — ignored while typing in another
  // field so it can't hijack normal text entry (e.g. a modal's own inputs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')))
        return
      const active = document.activeElement
      const isTypingElsewhere =
        active instanceof HTMLElement &&
        active !== searchInputRef.current &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.isContentEditable)
      if (isTypingElsewhere) return
      e.preventDefault()
      searchInputRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const {
    data: dataTasks,
    error: tasksError,
    mutate,
    isLoading: isLoadingTasks,
  } = useSWR<TaskType[], Error>(
    { url: endpoints.home.libraries.tasks },
    { revalidateOnFocus: true, revalidateOnMount: true },
  )

  const { data: dataMyRobots, error: myRobotsError } = useSWR<
    MyRobotType[],
    Error
  >({
    url: endpoints.home.libraries.myRobots,
  })
  const { data: dataObjects, error: objectsError } = useSWR<
    ObjectListType[],
    Error
  >({
    url: endpoints.home.libraries.objects,
  })
  const { data: dataLocations, error: locationsError } = useSWR<
    LocationListType[],
    Error
  >({
    url: endpoints.home.libraries.locations,
  })
  const { data: dataActions, error: actionsError } = useSWR<
    ActionListType[],
    Error
  >({
    url: endpoints.home.libraries.actions,
  })
  // "Check for problems" needs all four of these to give a meaningful
  // result — silently opening it with some dropdowns empty (previously
  // unhandled errors here) looks like a bug, not a connectivity issue.
  const referenceDataError = !!(
    myRobotsError ||
    objectsError ||
    locationsError ||
    actionsError
  )

  const [analyzeModalVisible, setAnalyzeModalVisible] = useState(false)
  const [analyzingTask, setAnalyzingTask] = useState<TaskType | null>(null)

  const storedUser: unknown = getFromLocalStorage(LocalStorageKey.USER)
  const currentUserId =
    typeof storedUser === 'object' &&
    storedUser !== null &&
    'id' in storedUser &&
    (typeof storedUser.id === 'string' || typeof storedUser.id === 'number')
      ? String(storedUser.id)
      : null

  const canManage = (owner: TaskType['owner']) =>
    currentUserId !== null && String(owner) === currentUserId

  const handleOpenWorkspace = (id: number) => {
    dispatch(activeItem(''))
    navigate(`/task/${id}`)
  }

  const handleOpenDetails = (id: number) => {
    dispatch(activeItem('tasks'))
    navigate(`/task/${id}/details`)
  }

  const handleDelete = (id: number) => {
    return fetchApi({
      url: endpoints.home.libraries.task,
      method: MethodHTTP.DELETE,
      body: { id },
    }).then(() => {
      toast.success(MessageText.success)
      mutate()
      const remaining = (dataTasks?.length ?? 1) - 1
      if (remaining <= page * rowsPerPage && page > 0) setPage(page - 1)
    })
  }

  const handleDiscard = (id: number) => {
    // No .then-chained .catch here: fetchApi already toasts every failure
    // path (services/api.ts) and rethrows — the call sites below absorb that
    // rejection instead, so it doesn't surface as unhandled without a second
    // redundant toast.
    return fetchApi({
      url: endpoints.task.discardDraft,
      method: MethodHTTP.POST,
      body: { id },
    }).then(() => {
      toast.success('Unpublished changes discarded')
      mutate()
    })
  }

  const handleAdd = () => {
    navigate('/task/new')
  }

  const rows = dataTasks ?? []
  const filteredRows = rows.filter((row) => {
    const matchesSearch =
      !search || row.name.toLowerCase().includes(search.toLowerCase())
    return (
      matchesSearch && matchesStatusFilter((row as any).status, statusFilter)
    )
  })
  const paginated = filteredRows.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )
  const isFiltering = search.trim() !== '' || statusFilter !== 'all'
  const draftCount = rows.filter((r) =>
    matchesStatusFilter((r as any).status, 'draft'),
  ).length
  const publishedCount = rows.filter((r) =>
    matchesStatusFilter((r as any).status, 'published'),
  ).length

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setPage(0)
  }

  // Tasks is the app's de-facto landing page (no separate marketing/dashboard
  // route) — the greeting + live status line replace a plain "Tasks" title
  // with something that actually orients a returning operator.
  const userName =
    typeof storedUser === 'object' &&
    storedUser !== null &&
    'username' in storedUser &&
    typeof (storedUser as Partial<UserLoginInterface>).username === 'string'
      ? (storedUser as Partial<UserLoginInterface>).username
      : ''
  const liveStatusLine = (() => {
    if (rows.length === 0) return 'No tasks yet — create your first one below.'
    if (statusFilter === 'published') {
      return `Showing ${publishedCount} published task${publishedCount !== 1 ? 's' : ''} ready to run`
    }
    if (statusFilter === 'draft') {
      return `Showing ${draftCount} draft${draftCount !== 1 ? 's' : ''} waiting`
    }
    const statusParts: string[] = []
    if (publishedCount > 0) {
      statusParts.push(
        `${publishedCount} task${publishedCount !== 1 ? 's' : ''} ready to run`,
      )
    }
    if (draftCount > 0) {
      statusParts.push(
        `${draftCount} draft${draftCount !== 1 ? 's' : ''} waiting`,
      )
    }
    return statusParts.length > 0
      ? statusParts.join(' · ')
      : 'No tasks yet — create your first one below.'
  })()

  const actionProps = {
    handleOpenDetails,
    setAnalyzeModalVisible,
    setAnalyzingTask,
    handleDelete,
    handleDiscard,
    referenceDataError,
  }

  return (
    <MainCard>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h3" component="h1" sx={{ fontWeight: 600 }}>
          {userName ? `Welcome back, ${userName}` : 'Welcome back'}
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
          {liveStatusLine}
        </Typography>
      </Box>

      {/* ── Toolbar ──
          No standalone row counter here — it would be a third count on
          screen at once alongside the welcome-back summary above and the
          per-status numbers on the filter tabs below. */}
      <Stack
        direction="row"
        sx={{
          mb: 2.5,
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 1.5,
          flexWrap: 'wrap',
        }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
          <OutlinedInput
            inputRef={searchInputRef}
            size="small"
            placeholder="Search tasks…"
            aria-label="Search tasks"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            startAdornment={
              <InputAdornment position="start">
                <Search size={16} />
              </InputAdornment>
            }
            endAdornment={
              <InputAdornment position="end">
                <KeycapHint>{modKey()}K</KeycapHint>
              </InputAdornment>
            }
            sx={{ width: 260 }}
          />
          <SegmentedControl
            exclusive
            value={statusFilter}
            onChange={(_e, v) => {
              if (v) {
                setStatusFilter(v)
                setPage(0)
              }
            }}
            options={[
              { value: 'all', label: `All ${rows.length}` },
              { value: 'draft', label: `${UI_TEXT.draft} ${draftCount}` },
              {
                value: 'published',
                label: `${UI_TEXT.published} ${publishedCount}`,
              },
            ]}
          />
          <Button
            variant="contained"
            color="primary"
            size="medium"
            startIcon={<Plus size={16} />}
            onClick={handleAdd}
            id="btn-add-task"
          >
            New Task
          </Button>
        </Stack>
      </Stack>

      {/* ── Card grid ── */}
      {isLoadingTasks ? (
        <Box
          sx={{
            maxHeight: 'calc(100vh - 280px)',
            overflow: 'auto',
            p: 2,
            m: -2,
          }}
        >
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 2,
            }}
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton
                key={i}
                variant="rounded"
                height={128}
                sx={{ borderRadius: '12px' }}
              />
            ))}
          </Box>
        </Box>
      ) : tasksError ? (
        <Stack spacing={1.5} sx={{ alignItems: 'center', py: 7 }}>
          <Typography variant="body2" color="error.dark">
            Couldn&apos;t load tasks. Check your connection and try again.
          </Typography>
          <Button size="small" onClick={() => mutate()}>
            Retry
          </Button>
        </Stack>
      ) : rows.length === 0 ? (
        <Stack spacing={1.5} sx={{ alignItems: 'center', py: 7 }}>
          <ListChecks size={32} color={tokenPalette.slate[400]} />
          <Typography variant="body2" color="text.secondary">
            No tasks yet. Create your first robot program visually.
          </Typography>
          <Button
            variant="contained"
            color="primary"
            size="small"
            startIcon={<Plus size={16} />}
            onClick={handleAdd}
            id="btn-add-task-empty"
          >
            New Task
          </Button>
        </Stack>
      ) : filteredRows.length === 0 ? (
        <Stack spacing={1.5} sx={{ alignItems: 'center', py: 7 }}>
          <Search size={32} color={tokenPalette.slate[400]} />
          <Typography variant="body2" color="text.secondary">
            No tasks match your search or filter.
          </Typography>
          {isFiltering && (
            <Button size="small" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </Stack>
      ) : (
        <>
          <Box
            sx={{
              maxHeight: 'calc(100vh - 280px)',
              overflow: 'auto',
              p: 2,
              m: -2,
            }}
          >
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 2,
              }}
            >
              {paginated.map((row) => (
                <TaskCard
                  key={row.id}
                  row={row}
                  canManage={canManage(row.owner)}
                  onOpen={() => handleOpenWorkspace(row.id)}
                  {...actionProps}
                />
              ))}
            </Box>
          </Box>
          <TablePagination
            rowsPerPageOptions={CARD_PAGE_SIZE_OPTIONS}
            component="div"
            count={filteredRows.length}
            rowsPerPage={rowsPerPage}
            page={page}
            onPageChange={(_, newPage) => setPage(newPage)}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10))
              setPage(0)
            }}
            sx={{ mt: 1 }}
          />
        </>
      )}

      {/* ── Modals ── */}
      <AnalyzeTaskModal
        task={analyzingTask}
        dataMyRobots={dataMyRobots || []}
        open={analyzeModalVisible}
        handleClose={() => setAnalyzeModalVisible(false)}
        dataObjects={dataObjects || []}
        dataLocations={dataLocations || []}
        dataActions={dataActions || []}
      />
    </MainCard>
  )
}

export default ListTasks
