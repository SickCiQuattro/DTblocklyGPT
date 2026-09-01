/**
 * Paginated list of the operator's own robot instances, with search, delete and a link to the matching form.
 *
 * One of seven sibling list pages (pages/*\/list*.tsx). Two patterns recur in
 * all of them and are worth reading once here rather than re-deriving per file:
 *
 * - **The empty `.catch` after a delete is deliberate.** `fetchApi` already
 *   raises a toast for the failure; the handler exists only so the rejection is
 *   not unhandled. Adding error UI there would double-report it.
 * - **The page index is clamped, not trusted.** A result set that shrinks under
 *   a stale page — a search, a filter, another tab deleting a row — used to
 *   render the "nothing found" empty state while rows existed on an earlier
 *   page. The effect below clamps the index instead of misreporting.
 *
 * `listTasks.tsx` is the exception: it carries the task lifecycle (draft /
 * published / published_with_draft) and its own actions, so it is much larger.
 */
import React, { useEffect, useState } from 'react'
import { useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { toast } from 'react-toastify'
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from '@mui/material'
import { Eye, Plus, Trash2 } from 'lucide-react'

import { MainCard } from 'components/MainCard'
import { ConfirmDialog } from 'components/ConfirmDialog'
import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { activeItem } from 'store/reducers/menu'
import { MessageText } from 'utils/messages'
import { defaultCurrentPage, defaultPageSizeSelection } from 'utils/constants'
import { useDocumentTitle } from 'hooks/useDocumentTitle'

import { MyRobotType } from './types'

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
    }}
  >
    {children}
  </TableCell>
)

const ListMyRobots = () => {
  useDocumentTitle('My Robot')
  const [page, setPage] = useState(defaultCurrentPage - 1) // MUI is 0-indexed
  const [rowsPerPage, setRowsPerPage] = useState(defaultPageSizeSelection)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const navigate = useNavigate()
  const dispatch = useDispatch()

  const { data, error, mutate, isLoading } = useSWR<MyRobotType[], Error>({
    url: endpoints.home.libraries.myRobots,
  })

  const handleDetail = (id: number) => {
    void dispatch(activeItem(''))
    void navigate(`/myrobot/${id}`)
  }

  const handleDelete = (id: number) => {
    return fetchApi({
      url: endpoints.home.libraries.myRobot,
      method: MethodHTTP.DELETE,
      body: { id },
    })
      .then(() => {
        toast.success(MessageText.success)
        void mutate()
        const remaining = (data?.length ?? 1) - 1
        if (remaining <= page * rowsPerPage && page > 0) setPage(page - 1)
      })
      .catch(() => {
        // fetchApi already surfaces a toast for the failure — this only
        // stops it becoming an unhandled promise rejection.
      })
  }

  const handleAdd = () => {
    void dispatch(activeItem(''))
    void navigate('/myrobot/add')
  }

  const rows = data ?? []
  const paginated = rows.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )

  // A page left stale by a shrinking result set (search, filter, another
  // tab's delete) made the empty-state ("No robots found") fire even
  // though rows exist, just not on this page — clamp instead of misreport.
  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(rows.length / rowsPerPage) - 1)
    if (page > maxPage) setPage(maxPage)
  }, [rows.length, rowsPerPage, page])

  return (
    <MainCard
      title="My Robot"
      subtitle="Here you can view and manage the personal robot defined for your profile."
    >
      <Stack
        direction="row"
        sx={{ mb: 2.5, alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Typography variant="body2" color="text.secondary">
          {rows.length} robot{rows.length !== 1 ? 's' : ''}
        </Typography>
        <Button
          variant="contained"
          color="primary"
          size="medium"
          startIcon={<Plus size={16} />}
          onClick={handleAdd}
          sx={{
            borderRadius: '8px',
            fontWeight: 500,
            fontSize: '0.875rem',
          }}
        >
          Add Robot
        </Button>
      </Stack>

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
          sx={{ maxHeight: 'calc(100vh - 280px)', overflow: 'auto' }}
        >
          <Table size="small" aria-label="myrobots table">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <ColHead>Name</ColHead>
                <ColHead>Robot</ColHead>
                <ColHead>Detail</ColHead>
                <ColHead>Operations</ColHead>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 6 }}>
                    <CircularProgress
                      size={28}
                      sx={{ color: 'primary.main' }}
                    />
                  </TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 6 }}>
                    <Stack spacing={1} sx={{ alignItems: 'center' }}>
                      <Typography variant="body2" color="error.dark">
                        Couldn&apos;t load robots. Check your connection and try
                        again.
                      </Typography>
                      <Button size="small" onClick={() => mutate()}>
                        Retry
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ) : paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 6 }}>
                    <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
                      <Typography variant="body2" color="text.secondary">
                        No robots found for your profile. Add one to get
                        started.
                      </Typography>
                      <Button
                        variant="contained"
                        color="primary"
                        size="small"
                        startIcon={<Plus size={16} />}
                        onClick={handleAdd}
                      >
                        Add Robot
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell sx={{ py: 1, fontWeight: 500 }}>
                      {row.name}
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>{row.robot_name}</TableCell>
                    <TableCell sx={{ py: 1 }}>
                      <IconButton
                        onClick={() => handleDetail(row.id)}
                        color="primary"
                        aria-label="detail"
                        title="View robot details"
                        size="small"
                      >
                        <Eye size={18} />
                      </IconButton>
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>
                      <IconButton
                        color="error"
                        title="Delete this robot"
                        aria-label="Delete this robot"
                        onClick={() => setDeleteId(row.id)}
                        size="small"
                      >
                        <Trash2 size={18} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          rowsPerPageOptions={[5, 10, 25]}
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
      <ConfirmDialog
        open={deleteId !== null}
        loading={isDeleting}
        message="Delete this robot? This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteId === null) return
          setIsDeleting(true)
          void handleDelete(deleteId).finally(() => {
            setIsDeleting(false)
            setDeleteId(null)
          })
        }}
        onCancel={() => setDeleteId(null)}
      />
    </MainCard>
  )
}

export default ListMyRobots
