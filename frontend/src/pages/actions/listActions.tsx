import React, { useState } from 'react'
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
import { Eye, Plus, CheckCircle2, XCircle, Trash2 } from 'lucide-react'

import { slate } from 'themes/theme'
import { MainCard } from 'components/MainCard'
import { tokenColor } from 'utils/tokenColors'
import { ConfirmDialog } from 'components/ConfirmDialog'
import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { activeItem } from 'store/reducers/menu'
import { MessageText } from 'utils/messages'
import { defaultCurrentPage, defaultPageSizeSelection } from 'utils/constants'
import { getFromLocalStorage, LocalStorageKey } from 'utils/localStorageUtils'
import { useDocumentTitle } from 'hooks/useDocumentTitle'

import { ActionListType } from './types'

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

const ListActions = () => {
  useDocumentTitle('Skills')
  const [page, setPage] = useState(defaultCurrentPage - 1) // MUI is 0-indexed
  const [rowsPerPage, setRowsPerPage] = useState(defaultPageSizeSelection)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const navigate = useNavigate()
  const dispatch = useDispatch()

  const storedUser: unknown = getFromLocalStorage(LocalStorageKey.USER)
  const currentUserId =
    typeof storedUser === 'object' &&
    storedUser !== null &&
    'id' in storedUser &&
    (typeof storedUser.id === 'string' || typeof storedUser.id === 'number')
      ? String(storedUser.id)
      : null

  const canManageAction = (owner: ActionListType['owner']) =>
    currentUserId !== null && String(owner) === currentUserId

  const { data, error, mutate, isLoading } = useSWR<ActionListType[], Error>({
    url: endpoints.home.libraries.actions,
  })

  const handleDetail = (id: number) => {
    void dispatch(activeItem(''))
    void navigate(`/action/${id}`)
  }

  const handleDelete = (id: number) => {
    void fetchApi<unknown, { id: number }>({
      url: endpoints.home.libraries.action,
      method: MethodHTTP.DELETE,
      body: { id },
    }).then(() => {
      toast.success(MessageText.success)
      void mutate()
      const remaining = (data?.length ?? 1) - 1
      if (remaining <= page * rowsPerPage && page > 0) setPage(page - 1)
    })
  }

  const handleAdd = () => {
    void dispatch(activeItem(''))
    void navigate('/action/add')
  }

  const rows = data ?? []
  const paginated = rows.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )

  return (
    <MainCard
      title="Skills List"
      subtitle="Here you can view and manage defined Skills."
    >
      <Stack
        direction="row"
        sx={{ mb: 2.5, alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Typography variant="body2" color="text.secondary">
          {rows.length} skill{rows.length !== 1 ? 's' : ''}
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
          Add Skill
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
          <Table size="small" aria-label="actions table">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <ColHead>Detail</ColHead>
                <ColHead>Name</ColHead>
                <ColHead>Owner</ColHead>
                <ColHead>Shared</ColHead>
                <ColHead>Keywords</ColHead>
                <ColHead>Operations</ColHead>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                    <CircularProgress
                      size={28}
                      sx={{ color: 'primary.main' }}
                    />
                  </TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                    <Stack spacing={1} sx={{ alignItems: 'center' }}>
                      <Typography variant="body2" color="error.main">
                        Couldn&apos;t load skills. Check your connection and try
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
                  <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                    <Typography variant="body2" color="text.secondary">
                      No skills found. Create your first skill.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell sx={{ py: 1 }}>
                      <IconButton
                        onClick={() => handleDetail(row.id)}
                        color="primary"
                        aria-label="detail"
                        disabled={!canManageAction(row.owner)}
                        title="View skill details"
                        size="small"
                      >
                        <Eye size={18} />
                      </IconButton>
                    </TableCell>
                    <TableCell sx={{ py: 1, fontWeight: 500 }}>
                      {row.name}
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>{row.owner__username}</TableCell>
                    <TableCell sx={{ py: 1 }}>
                      {row.shared ? (
                        <CheckCircle2
                          size={16}
                          color={tokenColor.successMain}
                        />
                      ) : (
                        <XCircle size={16} color={slate[400]} />
                      )}
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>
                      {row.keywords.length === 0 ? (
                        <Typography
                          variant="body2"
                          sx={{ fontStyle: 'italic', color: 'text.secondary' }}
                        >
                          None
                        </Typography>
                      ) : (
                        row.keywords.join(', ')
                      )}
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>
                      <IconButton
                        color="error"
                        disabled={!canManageAction(row.owner)}
                        title="Delete this skill"
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
        message="Delete this skill? This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteId !== null) handleDelete(deleteId)
          setDeleteId(null)
        }}
        onCancel={() => setDeleteId(null)}
      />
    </MainCard>
  )
}

export default ListActions
