import React, { useState } from 'react'
import { useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { toast } from 'react-toastify'
import {
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material'
import {
  Eye,
  Play,
  Cpu,
  ShieldCheck,
  BrainCircuit,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  ListChecks,
  MoreVertical,
} from 'lucide-react'

import { MainCard } from 'components/MainCard'
import { ConfirmPopover } from 'components/ConfirmPopover'
import { TaskStatusChip } from 'components/TaskStatusChip'
import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { activeItem, openDrawer } from 'store/reducers/menu'
import { MessageText } from 'utils/messages'
import { defaultCurrentPage, defaultPageSizeSelection } from 'utils/constants'
import { formatDateTimeFrontend } from 'utils/date'
import { getFromLocalStorage, LocalStorageKey } from 'utils/localStorageUtils'
import { MyRobotType } from 'pages/myrobots/types'
import { ObjectListType } from 'pages/objects/types'
import { LocationListType } from 'pages/locations/types'
import { ActionListType } from 'pages/actions/types'
import { Theme as ThemeOption } from 'themes/theme'

import { RunTaskModal } from './runTaskModal'
import { TaskType } from './types'
import { SimulateTaskModal } from './simulateTaskModal'
import { AnalyzeTaskModal } from './analyzeTaskModal'

// Menu/status icon colors sourced once from the design-system tokens (these
// render inside several sub-components without direct theme access).
const tokenPalette = ThemeOption()

// ─── Column header ────────────────────────────────────────────────────────────

const ColHead = ({ children }: { children: React.ReactNode }) => (
  <TableCell
    sx={{
      fontSize: '0.72rem',
      fontWeight: 700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'text.secondary',
      borderBottom: '1px solid',
      borderColor: 'divider',
      py: 1.5,
      whiteSpace: 'nowrap',
      fontFamily: "'Geist', 'Inter', sans-serif",
      backgroundColor: '#FAFAFA',
    }}
  >
    {children}
  </TableCell>
)

// ─── Task Row Actions Overflow Menu ──────────────────────────────────────────

const TaskRowActions = ({
  row,
  canManage,
  handleOpenDetails,
  setRunTaskModalVisible,
  setRunningTask,
  setSimulateTaskModalVisible,
  setSimulatingTask,
  setAnalyzeModalVisible,
  setAnalyzingTask,
  handleDelete,
}: {
  row: TaskType
  canManage: (owner: any) => boolean
  handleOpenDetails: (id: number) => void
  setRunTaskModalVisible: (v: boolean) => void
  setRunningTask: (t: TaskType) => void
  setSimulateTaskModalVisible: (v: boolean) => void
  setSimulatingTask: (t: TaskType) => void
  setAnalyzeModalVisible: (v: boolean) => void
  setAnalyzingTask: (t: TaskType) => void
  handleDelete: (id: number) => void
}) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const open = Boolean(anchorEl)

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)
  }
  const handleClose = () => {
    setAnchorEl(null)
  }

  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <Tooltip title="Run task">
        <IconButton
          size="small"
          sx={{ color: 'success.main' }}
          onClick={() => {
            setRunTaskModalVisible(true)
            setRunningTask(row)
          }}
          id={`btn-run-task-${row.id}`}
          aria-label="run task"
        >
          <Play size={15} />
        </IconButton>
      </Tooltip>

      <IconButton size="small" onClick={handleClick} aria-label="more actions">
        <MoreVertical size={16} />
      </IconButton>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        slotProps={{
          paper: {
            sx: {
              borderRadius: '8px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
              border: '1px solid',
              borderColor: 'divider',
              minWidth: '150px',
            },
          },
        }}
      >
        <MenuItem
          onClick={() => {
            handleClose()
            handleOpenDetails(row.id)
          }}
          disabled={!canManage(row.owner)}
        >
          <ListItemIcon>
            <Eye size={15} />
          </ListItemIcon>
          <ListItemText
            primary={
              <Typography sx={{ fontSize: '0.85rem' }}>View details</Typography>
            }
          />
        </MenuItem>

        <MenuItem
          onClick={() => {
            handleClose()
            setSimulateTaskModalVisible(true)
            setSimulatingTask(row)
          }}
        >
          <ListItemIcon>
            <Cpu size={15} style={{ color: tokenPalette.warning.dark }} />
          </ListItemIcon>
          <ListItemText
            primary={
              <Typography sx={{ fontSize: '0.85rem' }}>Simulate</Typography>
            }
          />
        </MenuItem>

        <MenuItem
          onClick={() => {
            handleClose()
            setAnalyzeModalVisible(true)
            setAnalyzingTask(row)
          }}
        >
          <ListItemIcon>
            <BrainCircuit size={15} style={{ color: tokenPalette.info.dark }} />
          </ListItemIcon>
          <ListItemText
            primary={
              <Typography sx={{ fontSize: '0.85rem' }}>Verify Logic</Typography>
            }
          />
        </MenuItem>

        <ConfirmPopover
          title="Delete this task?"
          onConfirm={() => {
            handleClose()
            handleDelete(row.id)
          }}
        >
          {(onOpen) => (
            <MenuItem
              onClick={(e) => {
                if (!canManage(row.owner)) return
                onOpen(e)
              }}
              disabled={!canManage(row.owner)}
              sx={{ color: 'error.main' }}
            >
              <ListItemIcon>
                <Trash2 size={15} color="red" />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography sx={{ fontSize: '0.85rem', color: 'error.main' }}>
                    Delete
                  </Typography>
                }
              />
            </MenuItem>
          )}
        </ConfirmPopover>
      </Menu>
    </Stack>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

const ListTasks = () => {
  const [page, setPage] = useState(defaultCurrentPage - 1) // MUI is 0-indexed
  const [rowsPerPage, setRowsPerPage] = useState(defaultPageSizeSelection)
  const navigate = useNavigate()
  const dispatch = useDispatch()

  const {
    data: dataTasks,
    mutate,
    isLoading: isLoadingTasks,
  } = useSWR<TaskType[], Error>(
    { url: endpoints.home.libraries.tasks },
    { revalidateOnFocus: true, revalidateOnMount: true },
  )

  const { data: dataMyRobots } = useSWR<MyRobotType[], Error>({
    url: endpoints.home.libraries.myRobots,
  })
  const { data: dataObjects } = useSWR<ObjectListType[], Error>({
    url: endpoints.home.libraries.objects,
  })
  const { data: dataLocations } = useSWR<LocationListType[], Error>({
    url: endpoints.home.libraries.locations,
  })
  const { data: dataActions } = useSWR<ActionListType[], Error>({
    url: endpoints.home.libraries.actions,
  })

  const [runTaskModalVisible, setRunTaskModalVisible] = useState(false)
  const [runningTask, setRunningTask] = useState<TaskType | null>(null)
  const [simulateTaskModalVisible, setSimulateTaskModalVisible] =
    useState(false)
  const [simulatingTask, setSimulatingTask] = useState<TaskType | null>(null)
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
    fetchApi({
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

  const handleAdd = () => {
    dispatch(openDrawer(false))
    navigate('/task/new')
  }

  // Paginated rows
  const rows = dataTasks ?? []
  const paginated = rows.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )

  return (
    <MainCard
      title="Tasks"
      subtitle="Manage and open your robot programming tasks."
    >
      {/* ── Toolbar ── */}
      <Stack
        direction="row"
        sx={{ mb: 2.5, alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Typography variant="body2" color="text.secondary">
          {rows.length} task{rows.length !== 1 ? 's' : ''}
        </Typography>
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

      {/* ── Table ── */}
      <Paper
        variant="outlined"
        sx={{
          borderRadius: '10px',
          overflow: 'hidden',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <TableContainer
          sx={{
            maxHeight: 'calc(100vh - 280px)',
            overflowY: 'auto',
            overflowX: 'hidden',
            pb: 2,
          }}
        >
          <Table size="small" aria-label="tasks table" stickyHeader>
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <ColHead>Name</ColHead>
                <ColHead>Status</ColHead>
                <ColHead>Owner</ColHead>
                <ColHead>Shared</ColHead>
                <ColHead>Last Modified</ColHead>
                <ColHead>Actions</ColHead>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoadingTasks ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                    <CircularProgress
                      size={28}
                      sx={{ color: 'primary.main' }}
                    />
                  </TableCell>
                </TableRow>
              ) : paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} sx={{ py: 7, border: 0 }}>
                    <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
                      <ListChecks size={32} color="#9CA3AF" />
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
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((row) => (
                  <TableRow
                    key={row.id}
                    hover
                    sx={{
                      cursor: 'pointer',
                      '&:nth-of-type(even)': { backgroundColor: '#FAFAFA' },
                      '&:hover': { backgroundColor: '#EEF2FF' },
                      '&:last-child td': { border: 0 },
                      '& td': { borderColor: 'divider' },
                    }}
                    onClick={() =>
                      canManage(row.owner) && handleOpenWorkspace(row.id)
                    }
                  >
                    {/* Name */}
                    <TableCell>
                      <Link
                        component="button"
                        type="button"
                        underline="hover"
                        disabled={!canManage(row.owner)}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleOpenWorkspace(row.id)
                        }}
                        aria-label={`Open ${row.name} workspace`}
                        sx={{
                          p: 0,
                          textAlign: 'left',
                          fontWeight: 600,
                          fontSize: '0.875rem',
                          fontFamily: "'Geist', 'Inter', sans-serif",
                          color: 'text.primary',
                          cursor: canManage(row.owner) ? 'pointer' : 'default',
                          '&:disabled': {
                            color: 'text.primary',
                            cursor: 'default',
                          },
                        }}
                      >
                        {row.name}
                      </Link>
                      {row.description && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            display: 'block',
                            mt: 0.25,
                            maxWidth: 280,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {row.description}
                        </Typography>
                      )}
                    </TableCell>

                    {/* Status */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <TaskStatusChip status={(row as any).status} />
                    </TableCell>

                    {/* Owner */}
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {(row as any).owner__username ?? '—'}
                      </Typography>
                    </TableCell>

                    {/* Shared */}
                    <TableCell>
                      {row.shared ? (
                        <CheckCircle2
                          size={16}
                          color={tokenPalette.success.main}
                        />
                      ) : (
                        <XCircle size={16} color="#9CA3AF" />
                      )}
                    </TableCell>

                    {/* Last Modified */}
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {formatDateTimeFrontend(row.last_modified)}
                      </Typography>
                    </TableCell>

                    {/* Actions */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <TaskRowActions
                        row={row}
                        canManage={canManage}
                        handleOpenDetails={handleOpenDetails}
                        setRunTaskModalVisible={setRunTaskModalVisible}
                        setRunningTask={setRunningTask}
                        setSimulateTaskModalVisible={
                          setSimulateTaskModalVisible
                        }
                        setSimulatingTask={setSimulatingTask}
                        setAnalyzeModalVisible={setAnalyzeModalVisible}
                        setAnalyzingTask={setAnalyzingTask}
                        handleDelete={handleDelete}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          rowsPerPageOptions={[10, 25, 40]}
          component="div"
          count={rows.length}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10))
            setPage(0)
          }}
          sx={{ borderTop: '1px solid', borderColor: 'divider' }}
        />
      </Paper>

      {/* ── Modals ── */}
      <RunTaskModal
        task={runningTask}
        dataMyRobots={dataMyRobots || []}
        open={runTaskModalVisible}
        handleClose={() => setRunTaskModalVisible(false)}
      />
      <SimulateTaskModal
        task={simulatingTask}
        open={simulateTaskModalVisible}
        handleClose={() => setSimulateTaskModalVisible(false)}
      />
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
