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
import { useTheme } from '@mui/material/styles'
import { AlertTriangle } from 'lucide-react'

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
  const theme = useTheme()
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
      // Synchronous, whole-task request — see DigitalTwinPanel.tsx runTask.
      timeout: 600000,
    })
      .then(() => {
        toast.success(MessageText.runningTask)
        handleClose()
      })
      .catch((error: any) => {
        // Server refuses if hardware isn't armed; a place/pick can also abort
        // mid-task (missed grasp, IK failure, twin divergence) — either way
        // the operator needs to see it, not a dialog that just closes.
        toast.error(error?.message || 'Error running task on the robot')
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
      <DialogTitle sx={{ pb: 1 }}>Run on the real robot?</DialogTitle>

      <DialogContent sx={{ py: 1.5 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1,
            mb: 2,
            p: 1.5,
            borderRadius: '8px',
            bgcolor: 'warning.lighter',
            border: '1px solid',
            borderColor: 'warning.light',
          }}
        >
          <AlertTriangle
            size={16}
            style={{ marginTop: 2, flexShrink: 0 }}
            color={theme.palette.warning.dark}
          />
          <Typography variant="body2" color="text.primary">
            <strong>{task?.name}</strong> will run on the physical robot. Make
            sure the workcell is clear and the e-stop is within reach.
          </Typography>
        </Box>

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
            id="run-when-label"
            sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'text.primary' }}
          >
            WHEN conditions
          </FormLabel>
          <RadioGroup
            aria-labelledby="run-when-label"
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
              ? 'Every WHEN block runs immediately, skipping its real trigger.'
              : 'Every WHEN block waits for its real trigger (gesture, object detection, timer) on the physical robot.'}
          </Typography>
        </FormControl>
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
