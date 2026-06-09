import React from 'react'
import { toast } from 'react-toastify'
import {
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
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
import { MyRobotType } from 'pages/myrobots/types'

import { TaskType } from './types'

interface RunTaskModalProps {
  task: TaskType | null
  dataMyRobots: MyRobotType[]
  open: boolean
  handleClose: () => void
}

export const RunTaskModal = ({
  task,
  dataMyRobots,
  open,
  handleClose,
}: RunTaskModalProps) => {
  const [selectedRobot, setSelectedRobot] = React.useState<number | string>('')
  const [running, setRunning] = React.useState(false)
  const [simulateEvent, setSimulateEvent] = React.useState(false)

  const handleOk = () => {
    setRunning(true)

    fetchApi({
      url: endpoints.task.run,
      method: MethodHTTP.POST,
      body: { id: task?.id, robot: selectedRobot, sensorhuman: simulateEvent },
    })
      .then(() => {
        toast.success(MessageText.runningTask)
        handleClose()
        setSelectedRobot('')
      })
      .finally(() => {
        setRunning(false)
      })
  }

  const handleCancelClick = () => {
    handleClose()
    setSelectedRobot('')
  }

  return (
    <Dialog
      open={open}
      onClose={handleCancelClick}
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
        Run task: {task?.name}
      </DialogTitle>
      
      <DialogContent sx={{ py: 1.5 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Are you sure you want to run this task on a robot?
        </Typography>
        
        <Box sx={{ mb: 3 }}>
          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', display: 'block', mb: 0.5 }}>
            Description
          </Typography>
          <Typography variant="body2" sx={{ fontStyle: task?.description ? 'normal' : 'italic', color: 'text.primary', bgcolor: 'rgba(0, 0, 0, 0.02)', p: 1.5, borderRadius: '6px', border: '1px solid', borderColor: 'divider' }}>
            {task?.description || 'None'}
          </Typography>
        </Box>

        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel id="robot-id-label">Robot</InputLabel>
          <Select
            labelId="robot-id-label"
            id="robot"
            value={selectedRobot || ''}
            label="Robot"
            name="robot"
            onChange={(e) => {
              setSelectedRobot(e.target.value)
            }}
            title="Robot used to run the task"
          >
            {dataMyRobots?.map((myRobot) => (
              <MenuItem value={myRobot.id} key={myRobot.id}>
                {myRobot.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

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
          disabled={!selectedRobot || running}
          startIcon={running ? <CircularProgress size={14} color="inherit" /> : null}
          sx={{ fontWeight: 500, borderRadius: '8px', minWidth: '80px' }}
        >
          Run
        </Button>
      </DialogActions>
    </Dialog>
  )
}
