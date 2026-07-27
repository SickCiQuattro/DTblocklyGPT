import React from 'react'
import { toast } from 'react-toastify'
import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  CircularProgress,
  Stack,
} from '@mui/material'
import { CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react'

import { analyzeAbstractTask, AnalyzerIssue } from 'utils/taskAnalyzer'
import { MyRobotType } from 'pages/myrobots/types'
import { ObjectListType } from 'pages/objects/types'
import { LocationListType } from 'pages/locations/types'
import { ActionListType } from 'pages/actions/types'
import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { blocklyToAbstractAll, CustomBlock } from 'utils/blocklyParser'

import {
  AbstractRobot,
  AbstractStep,
  AbstractTask,
  TaskDetailType,
  TaskType,
} from './types'

interface AnalyzeTaskModalProps {
  task: TaskType | null
  dataMyRobots: MyRobotType[]
  open: boolean
  handleClose: () => void
  dataObjects?: ObjectListType[]
  dataLocations?: LocationListType[]
  dataActions?: ActionListType[]
}

export const AnalyzeTaskModal = ({
  task,
  dataMyRobots,
  open,
  handleClose,
  dataObjects,
  dataLocations,
  dataActions,
}: AnalyzeTaskModalProps) => {
  const [selectedRobot, setSelectedRobot] = React.useState<number | string>('')
  const [analyzing, setAnalyzing] = React.useState(false)
  const [taskAnalyzed, setTaskAnalyzed] = React.useState<boolean>(false)
  const [analyzeResults, setAnalyzeResults] = React.useState<AnalyzerIssue[]>(
    [],
  )

  const handleOk = async () => {
    setAnalyzing(true)
    if (!task) {
      setAnalyzing(false)
      return
    }

    try {
      const response = await fetchApi<TaskDetailType>({
        url: endpoints.home.libraries.task,
        method: MethodHTTP.GET,
        body: { id: task.id },
      })
      const code = response?.code
      if (!code) {
        toast.error('No task code found for analysis')
        setAnalyzing(false)
        return
      }
      const taskCode = typeof code === 'string' ? JSON.parse(code) : code

      let abstractSteps: AbstractStep[] = []
      if (Array.isArray(taskCode) && taskCode.length > 0) {
        // If the first item's type ends with '_block' or is 'when_start', it's a Blockly payload
        const isBlockly = taskCode.some(
          (b: any) =>
            typeof b.type === 'string' &&
            (b.type === 'when_start' || b.type.endsWith('_block')),
        )

        if (isBlockly) {
          const branches = blocklyToAbstractAll(taskCode as CustomBlock[]) || []
          abstractSteps = branches.find((b) => b.isMain)?.steps || []
        } else {
          // Otherwise, assume it is already an AbstractStep[]
          abstractSteps = taskCode as AbstractStep[]
        }
      } else if (taskCode && typeof taskCode.type === 'string') {
        const branches = blocklyToAbstractAll(taskCode as CustomBlock) || []
        abstractSteps = branches.find((b) => b.isMain)?.steps || []
      }

      const analyzingTask: AbstractTask = {
        taskName: task.name,
        description: task.description,
        steps: abstractSteps,
      }

      // Map objects, locations, actions to analyzer types
      analyzingTask.objects =
        dataObjects?.map((obj) => ({
          id: obj.id,
          name: obj.name,
          weight: obj.weight ?? undefined,
          obj_length: obj.obj_length ?? undefined,
          obj_width: obj.obj_width ?? undefined,
        })) || []

      analyzingTask.locations =
        dataLocations?.map((loc) => ({
          id: loc.id,
          name: loc.name,
        })) || []

      analyzingTask.actions =
        dataActions?.map((act) => ({
          id: act.id,
          name: act.name,
        })) || []

      analyzingTask.robot = dataMyRobots
        .map((robot) => ({
          id: robot.id,
          max_load: robot.robot__max_load ?? undefined,
          max_open_tool: robot.robot__max_open_tool ?? undefined,
        }))
        .find((robot) => robot.id === selectedRobot)

      const results = analyzeAbstractTask(analyzingTask)
      setTaskAnalyzed(true)
      setAnalyzeResults(results)
      setAnalyzing(false)
    } catch {
      toast.error('Failed to analyze task')
      setAnalyzing(false)
    }
  }

  const handleCancelClick = () => {
    setAnalyzing(false)
    setTaskAnalyzed(false)
    handleClose()
    setSelectedRobot('')
    setAnalyzeResults([])
  }

  return (
    <Dialog
      open={open}
      onClose={handleCancelClick}
      slotProps={{
        paper: { sx: { p: 1.5, maxWidth: '520px', width: '100%' } },
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>Analyze task: {task?.name}</DialogTitle>

      <DialogContent sx={{ py: 1.5 }}>
        {analyzing && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={36} />
          </Box>
        )}

        {!analyzing && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Are you sure you want to perform static verification checks on
              this task?
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

            <FormControl fullWidth sx={{ mb: 3 }}>
              <InputLabel id="robot-id-label">Robot</InputLabel>
              <Select
                labelId="robot-id-label"
                id="robot"
                value={selectedRobot || ''}
                label="Robot"
                name="robot"
                onChange={(e) => {
                  setSelectedRobot(e.target.value)
                  setTaskAnalyzed(false)
                  setAnalyzeResults([])
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

            <Box sx={{ mt: 2, mb: 1 }}>
              {taskAnalyzed &&
                (analyzeResults.length === 0 ? (
                  <Alert
                    severity="success"
                    icon={<CheckCircle2 size={18} />}
                    sx={{ borderRadius: '8px' }}
                  >
                    No issues found. Task logic is completely valid!
                  </Alert>
                ) : (
                  <Stack spacing={2}>
                    <Alert
                      severity="error"
                      icon={<AlertCircle size={18} />}
                      sx={{ borderRadius: '8px' }}
                    >
                      Issues detected. Please review prior to execution.
                    </Alert>

                    <Box
                      component="ul"
                      sx={{
                        pl: 2.5,
                        m: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1.5,
                        maxHeight: '200px',
                        overflowY: 'auto',
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: '8px',
                        p: 2,
                        bgcolor: 'grey.50',
                      }}
                    >
                      {analyzeResults.map((issue, idx) => (
                        <Box
                          component="li"
                          key={idx}
                          sx={{
                            // .main fails AA as text on this light bg (error
                            // 3.61:1, warning 2.06:1) — .dark/.darker clear it.
                            color:
                              issue.type === 'error'
                                ? 'error.dark'
                                : 'warning.darker',
                            fontSize: '0.85rem',
                          }}
                        >
                          <Typography
                            component="span"
                            variant="subtitle2"
                            color="inherit"
                            sx={{ fontWeight: 600 }}
                          >
                            {issue.message}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block', mt: 0.25 }}
                          >
                            At:{' '}
                            {issue.stepPath
                              .map((step) =>
                                typeof step === 'number' ? step + 1 : step,
                              )
                              .join(' > ')}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  </Stack>
                ))}
            </Box>
          </>
        )}
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
          disabled={!selectedRobot || analyzing}
          sx={{ fontWeight: 500, borderRadius: '8px', minWidth: '80px' }}
        >
          Analyze
        </Button>
      </DialogActions>
    </Dialog>
  )
}
