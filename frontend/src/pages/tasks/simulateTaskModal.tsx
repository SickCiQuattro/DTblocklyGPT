import React from 'react'
import { toast } from 'react-toastify'
import {
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
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

interface SimulateTaskModalProps {
  task: TaskType | null
  open: boolean
  handleClose: () => void
}

export const SimulateTaskModal = ({
  task,
  open,
  handleClose,
}: SimulateTaskModalProps) => {
  const [simulating, setSimulating] = React.useState(false)
  const [simulateEvent, setSimulateEvent] = React.useState(false)

  const handleOk = () => {
    setSimulating(true)

    fetchApi({
      url: endpoints.task.simulate,
      method: MethodHTTP.POST,
      body: {
        id: task?.id,
        simulateEvent,
      },
    })
      .then(() => {
        toast.success(MessageText.success)
        handleClose()
      })
      .catch((error: any) => {
        toast.error(error?.message || 'Error simulating task')
      })
      .finally(() => {
        setSimulating(false)
      })
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      slotProps={{
        paper: { sx: { p: 1.5, maxWidth: '480px', width: '100%' } },
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>Simulate task: {task?.name}</DialogTitle>

      <DialogContent sx={{ py: 1.5 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Are you sure you want to simulate this task?
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

        <FormControl>
          <FormLabel
            id="simulate-when-label"
            sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'text.primary' }}
          >
            WHEN conditions
          </FormLabel>
          <RadioGroup
            aria-labelledby="simulate-when-label"
            value={simulateEvent ? 'always' : 'wait'}
            onChange={(e) => setSimulateEvent(e.target.value === 'always')}
          >
            <FormControlLabel
              value="wait"
              control={<Radio size="small" />}
              label={
                <Typography variant="body2">Wait for real signals</Typography>
              }
            />
            <FormControlLabel
              value="always"
              control={<Radio size="small" />}
              label={<Typography variant="body2">Always fulfilled</Typography>}
            />
          </RadioGroup>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            {simulateEvent
              ? 'Every WHEN block runs immediately — use this to test the rest of the task without waiting for a gesture, object, or timer.'
              : 'Every WHEN block waits for its real trigger (gesture, object detection, timer) — matches how the task runs for real.'}
          </Typography>
        </FormControl>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <Button variant="text" onClick={handleClose} sx={{ fontWeight: 500 }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={handleOk}
          disabled={simulating}
          startIcon={
            simulating ? <CircularProgress size={14} color="inherit" /> : null
          }
          sx={{ fontWeight: 500, borderRadius: '8px', minWidth: '80px' }}
        >
          Simulate
        </Button>
      </DialogActions>
    </Dialog>
  )
}
