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
        simulateEvent: simulateEvent,
      },
    })
      .then(() => {
        toast.success(MessageText.success)
        handleClose()
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
        backdrop: {
          sx: {
            backdropFilter: 'blur(8px)',
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
          }
        },
        paper: {
          sx: {
            borderRadius: '12px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            border: '1px solid',
            borderColor: 'divider',
            p: 1.5,
            maxWidth: '480px',
            width: '100%',
          }
        }
      }}
    >
      <DialogTitle sx={{ fontWeight: 600, pb: 1, fontSize: '1.125rem' }}>
        Simulate task: {task?.name}
      </DialogTitle>

      <DialogContent sx={{ py: 1.5 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Are you sure you want to simulate this task?
        </Typography>

        <Box sx={{ mb: 3 }}>
          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', display: 'block', mb: 0.5 }}>
            Description
          </Typography>
          <Typography variant="body2" sx={{ fontStyle: task?.description ? 'normal' : 'italic', color: 'text.primary', bgcolor: 'rgba(0, 0, 0, 0.02)', p: 1.5, borderRadius: '6px', border: '1px solid', borderColor: 'divider' }}>
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
            <Typography variant="body2">WHEN conditions always fulfilled</Typography>
          }
          title="WHEN conditions always fulfilled"
        />
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <Button 
          variant="text" 
          onClick={handleClose}
          sx={{ fontWeight: 500 }}
        >
          Cancel
        </Button>
        <Button 
          variant="contained" 
          color="primary"
          onClick={handleOk}
          disabled={simulating}
          startIcon={simulating ? <CircularProgress size={14} color="inherit" /> : null}
          sx={{ fontWeight: 500, borderRadius: '8px', minWidth: '80px' }}
        >
          Simulate
        </Button>
      </DialogActions>
    </Dialog>
  )
}
