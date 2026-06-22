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
import { Eye, Plus, CheckCircle2, XCircle } from 'lucide-react'

import { MainCard } from 'components/MainCard'
import { tokenColor } from 'utils/tokenColors'
import { ConfirmPopover } from 'components/ConfirmPopover'
import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { activeItem } from 'store/reducers/menu'
import { MessageText } from 'utils/messages'
import { defaultCurrentPage, defaultPageSizeSelection } from 'utils/constants'
import { formatDateTimeFrontend } from 'utils/date'

import { UserListType } from './types'

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
    }}
  >
    {children}
  </TableCell>
)

const ListUsers = () => {
  const [page, setPage] = useState(defaultCurrentPage - 1) // MUI is 0-indexed
  const [rowsPerPage, setRowsPerPage] = useState(defaultPageSizeSelection)
  const navigate = useNavigate()
  const dispatch = useDispatch()

  const { data, mutate, isLoading } = useSWR<UserListType[], Error>({
    url: endpoints.home.management.users,
  })

  const handleDetail = (id: number) => {
    void dispatch(activeItem(''))
    void navigate(`/user/${id}`)
  }

  const handleDisable = (id: number, updatedActive: boolean) => {
    void fetchApi({
      url: endpoints.home.management.user,
      method: MethodHTTP.DELETE,
      body: {
        id,
        active: updatedActive,
      },
    }).then(() => {
      toast.success(MessageText.success)
      void mutate()
    })
  }

  const handleResetPassword = (id: number) => {
    void fetchApi({
      url: endpoints.home.management.resetPassword,
      method: MethodHTTP.POST,
      body: { id },
    }).then(() => toast.success(MessageText.success))
  }

  const handleAdd = () => {
    void dispatch(activeItem(''))
    void navigate('/user/add')
  }

  const rows = data ?? []
  const paginated = rows.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )

  return (
    <MainCard
      title="User Accounts"
      subtitle="Here you can see the list of the defined User Accounts."
    >
      <Stack
        direction="row"
        sx={{ mb: 2.5, alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Typography variant="body2" color="text.secondary">
          {rows.length} user account{rows.length !== 1 ? 's' : ''}
        </Typography>
        <Button
          variant="contained"
          color="primary"
          size="medium"
          startIcon={<Plus size={16} />}
          onClick={handleAdd}
          sx={{
            borderRadius: '8px',
            fontFamily: "'Geist', 'Inter', sans-serif",
            fontWeight: 500,
            fontSize: '0.875rem',
            textTransform: 'none',
          }}
        >
          Add User Account
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
          <Table size="small" aria-label="users table">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <ColHead>Detail</ColHead>
                <ColHead>Username</ColHead>
                <ColHead>Email</ColHead>
                <ColHead>Role</ColHead>
                <ColHead>Last Login</ColHead>
                <ColHead>Date Joined</ColHead>
                <ColHead>Active</ColHead>
                <ColHead>Operations</ColHead>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                    <CircularProgress
                      size={28}
                      sx={{ color: 'primary.main' }}
                    />
                  </TableCell>
                </TableRow>
              ) : paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                    <Typography variant="body2" color="text.secondary">
                      No user accounts found.
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
                        title="View user details"
                        size="small"
                      >
                        <Eye size={18} />
                      </IconButton>
                    </TableCell>
                    <TableCell sx={{ py: 1, fontWeight: 500 }}>
                      {row.username}
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>{row.email}</TableCell>
                    <TableCell sx={{ py: 1 }}>{row.role}</TableCell>
                    <TableCell sx={{ py: 1 }}>
                      {formatDateTimeFrontend(row.last_login)}
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>
                      {formatDateTimeFrontend(row.date_joined)}
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>
                      {row.is_active ? (
                        <CheckCircle2
                          size={16}
                          color={tokenColor.successMain}
                        />
                      ) : (
                        <XCircle size={16} color="#94A3B8" />
                      )}
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>
                      <Stack direction="row" spacing={1}>
                        <ConfirmPopover
                          title="Reset password?"
                          onConfirm={() => handleResetPassword(row.id)}
                        >
                          {(onOpen) => (
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={onOpen}
                              title="Reset user password"
                              sx={{
                                py: 0.25,
                                px: 1,
                                fontSize: '0.75rem',
                                borderRadius: '6px',
                              }}
                            >
                              Reset
                            </Button>
                          )}
                        </ConfirmPopover>

                        <ConfirmPopover
                          title={
                            row.is_active ? 'Disable user?' : 'Enable user?'
                          }
                          onConfirm={() =>
                            handleDisable(row.id, !row.is_active)
                          }
                        >
                          {(onOpen) => (
                            <Button
                              size="small"
                              variant="contained"
                              color={row.is_active ? 'error' : 'primary'}
                              onClick={onOpen}
                              title={
                                row.is_active
                                  ? 'Disable this user'
                                  : 'Enable this user'
                              }
                              sx={{
                                py: 0.25,
                                px: 1,
                                fontSize: '0.75rem',
                                borderRadius: '6px',
                              }}
                            >
                              {row.is_active ? 'Disable' : 'Enable'}
                            </Button>
                          )}
                        </ConfirmPopover>
                      </Stack>
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
    </MainCard>
  )
}

export default ListUsers
