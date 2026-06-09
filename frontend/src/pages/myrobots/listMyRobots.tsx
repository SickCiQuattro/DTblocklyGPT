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
import { Eye, Plus, Trash2 } from 'lucide-react'

import { MainCard } from 'components/MainCard'
import { ConfirmPopover } from 'components/ConfirmPopover'
import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { activeItem } from 'store/reducers/menu'
import { MessageText } from 'utils/messages'
import { defaultCurrentPage, defaultPageSizeSelection } from 'utils/constants'

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
      fontFamily: "'Geist', 'Inter', sans-serif",
    }}
  >
    {children}
  </TableCell>
)

const ListMyRobots = () => {
  const [page, setPage] = useState(defaultCurrentPage - 1) // MUI is 0-indexed
  const [rowsPerPage, setRowsPerPage] = useState(defaultPageSizeSelection)
  const navigate = useNavigate()
  const dispatch = useDispatch()

  const { data, mutate, isLoading } = useSWR<MyRobotType[], Error>({
    url: endpoints.home.libraries.myRobots,
  })

  const handleDetail = (id: number) => {
    void dispatch(activeItem(''))
    void navigate(`/myrobot/${id}`)
  }

  const handleDelete = (id: number) => {
    void fetchApi({
      url: endpoints.home.libraries.myRobot,
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
    void navigate('/myrobot/add')
  }

  const rows = data ?? []
  const paginated = rows.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )

  return (
    <MainCard
      title="My Robot"
      subtitle="Here you can see the personal robot defined for your profile."
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
            fontFamily: "'Geist', 'Inter', sans-serif",
            fontWeight: 500,
            fontSize: '0.875rem',
            textTransform: 'none',
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
                <ColHead>Detail</ColHead>
                <ColHead>Name</ColHead>
                <ColHead>Robot</ColHead>
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
              ) : paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 6 }}>
                    <Typography variant="body2" color="text.secondary">
                      No robots found for your profile. Add one to get started.
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
                        title="View robot details"
                        size="small"
                      >
                        <Eye size={18} />
                      </IconButton>
                    </TableCell>
                    <TableCell sx={{ py: 1, fontWeight: 500 }}>
                      {row.name}
                    </TableCell>
                    <TableCell sx={{ py: 1 }}>{row.robot_name}</TableCell>
                    <TableCell sx={{ py: 1 }}>
                      <ConfirmPopover
                        title="Delete this robot?"
                        onConfirm={() => handleDelete(row.id)}
                      >
                        {(onOpen) => (
                          <IconButton
                            color="error"
                            title="Delete this robot"
                            onClick={onOpen}
                            size="small"
                          >
                            <Trash2 size={18} />
                          </IconButton>
                        )}
                      </ConfirmPopover>
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

export default ListMyRobots
