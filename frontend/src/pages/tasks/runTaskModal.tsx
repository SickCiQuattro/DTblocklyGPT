import React from 'react'
import { toast } from 'react-toastify'
import {
  Checkbox,
  FormControlLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  CircularProgress,
} from '@mui/material'

import { MethodHTTP, fetchApi } from 'services/api'
import { endpoints } from 'services/endpoints'
import { MessageText } from 'utils/messages'

import { TaskType } from './types'

interface RunTaskModalProps {
  task: TaskType | null
  open: boolean
  handleClose: () => void
}

export const RunTaskModal = ({
  task,
  open,
  handleClose,
}: RunTaskModalProps) => {
  const [running, setRunning] = React.useState(false)
  const [simulateEvent, setSimulateEvent] = React.useState(false)

  // Real-robot runs go through the same /api/task/simulate/ path as
  // Simulation (IK, abort-on-fault gates, encoder verification) — driveHardware
  // just tells the server to also forward key poses to the real arm. Requires
  // the server to be armed (DRIVE_HARDWARE); the backend refuses otherwise.
  const handleOk = () => {
    setRunning(true)

    fetchApi({
      url: endpoints.task.simulate,
      method: MethodHTTP.POST,
      body: { id: task?.id, simulateEvent, driveHardware: true },
    })
      .then(() => {
        toast.success(MessageText.runningTask)
        handleClose()
      })
      .finally(() => {
        setRunning(false)
      })
  }

  const handleCancelClick = () => {
    handleClose()
  }

  return (
    <Dialog
      open={open}
      onClose={handleCancelClick}
      slotProps={{
        paper: { sx: { p: 1.5, maxWidth: '480px', width: '100%' } },
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>Run task: {task?.name}</DialogTitle>

      <DialogContent sx={{ py: 1.5 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Are you sure you want to run this task on a robot?
        </Typography>

        <Box sx={{ mb: 3 }}>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600,
              color: 'text.secondary',
              textTransform: 'uppercase',
              display: 'block',
              mb: 0.5,
            }}
          >
            Description
          </Typography>
          <Typography
            variant="body2"
            sx={{
              fontStyle: task?.description ? 'normal' : 'italic',
              color: 'text.primary',
              bgcolor: 'rgba(0, 0, 0, 0.02)',
              p: 1.5,
              borderRadius: '6px',
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            {task?.description || 'None'}
          </Typography>
        </Box>

        <FormControlLabel
          control={
            <Checkbox
              id="simulateEvent"
              value={simulateEvent}
              name="simulateEvent"
              onChange={() => setSimulateEvent(!simulateEvent)}
              checked={simulateEvent}
            />
          }
          label={
            <Typography variant="body2">Simulate condition events</Typography>
          }
          title="Simulate condition events for debug purpose"
        />
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <Button
          variant="text"
          onClick={handleCancelClick}
          sx={{ fontWeight: 500 }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={handleOk}
          disabled={running}
          startIcon={
            running ? <CircularProgress size={14} color="inherit" /> : null
          }
          sx={{ fontWeight: 500, borderRadius: '8px', minWidth: '80px' }}
        >
          Run
        </Button>
      </DialogActions>
    </Dialog>
  )
}
