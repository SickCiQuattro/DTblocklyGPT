import { Modal, Spin } from 'antd'
import React from 'react'
import { toast } from 'react-toastify'
import { analyzeAbstractTask, AnalyzerIssue } from 'utils/taskAnalyzer'
import { AbstractRobot, AbstractTask, TaskType } from './types'
import { MyRobotType } from 'pages/myrobots/types'
import { Alert, FormControl, InputLabel, MenuItem, Select } from '@mui/material'
import { ObjectListType } from 'pages/objects/types'
import { LocationListType } from 'pages/locations/types'
import { ActionListType } from 'pages/actions/types'
import { CheckOutlined } from '@ant-design/icons'

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
      const code = task?.code
      if (!code) {
        toast.error('No task code found for analysis')
        return
      }
      const taskCode = typeof code === 'string' ? JSON.parse(code) : code

      const analyzingTask: AbstractTask = {
        taskName: task.name,
        description: task.description,
        steps: taskCode,
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
        .find((robot) => robot.id === selectedRobot) as
        | AbstractRobot
        | undefined
      // Optionally, add robot info if available
      const results = analyzeAbstractTask(analyzingTask)
      setTaskAnalyzed(true)
      setAnalyzeResults(results)
      setAnalyzing(false)
    } catch {
      toast.error('Failed to analyze task')
    }
  }

  return (
    <Modal
      title={`Analyze task ${task?.name}`}
      open={open}
      onOk={handleOk}
      okText="Analyze"
      okButtonProps={{ disabled: !selectedRobot, loading: analyzing }}
      onCancel={() => {
        setAnalyzing(false)
        setTaskAnalyzed(false)
        handleClose()
        setSelectedRobot('')
      }}
      cancelButtonProps={{ style: { float: 'left' } }}
      maskClosable={false}
      closeIcon={null}
    >
      <p>Are you sure to analyze this task?</p>
      <p style={{ marginTop: '2rem', fontWeight: 400 }}>Description:</p>
      {task?.description ? (
        <p>
          <i>{task?.description}</i>
        </p>
      ) : (
        <p>
          <i>None</i>
        </p>
      )}
      <FormControl fullWidth style={{ marginTop: '2rem' }}>
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
          title="Robot use to run the task"
        >
          {dataMyRobots?.map((myRobot) => (
            <MenuItem value={myRobot.id} key={myRobot.id}>
              {myRobot.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <div style={{ marginTop: '2rem', marginBottom: '2rem' }}>
        {taskAnalyzed &&
          (analyzeResults.length === 0 ? (
            <Alert icon={<CheckOutlined />} severity="success">
              No issues found. Task is valid!
            </Alert>
          ) : (
            <ul>
              {analyzeResults.map((issue) => (
                <li
                  key={issue.message}
                  style={{ color: issue.type === 'error' ? 'red' : 'orange' }}
                >
                  {issue.message} (at step {issue.stepPath.join(' > ')})
                </li>
              ))}
            </ul>
          ))}
      </div>
      {analyzing && (
        <Spin
          size="large"
          style={{
            top: '50%',
            left: '50%',
          }}
        />
      )}
    </Modal>
  )
}
