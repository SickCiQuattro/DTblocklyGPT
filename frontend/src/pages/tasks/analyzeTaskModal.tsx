import { Modal, Spin } from 'antd'
import React from 'react'
import { toast } from 'react-toastify'
import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { MessageText } from 'utils/messages'
import { AnalyzerIssue } from 'utils/taskAnalyzer'
import { TaskType } from './types'
import { MyRobotType } from 'pages/myrobots/types'
import { FormControl, InputLabel, MenuItem, Select } from '@mui/material'

interface AnalyzeTaskModalProps {
  task: TaskType | null
  dataMyRobots: MyRobotType[]
  open: boolean
  handleClose: () => void
}

export const AnalyzeTaskModal = ({
  task,
  dataMyRobots,
  open,
  handleClose,
}: AnalyzeTaskModalProps) => {
  const [selectedRobot, setSelectedRobot] = React.useState<number | string>('')
  const [analyzing, setAnalyzing] = React.useState(false)
  const [taskAnalyzed, setTaskAnalyzed] = React.useState<boolean>(false)
  const [analyzeResults, setAnalyzeResults] = React.useState<AnalyzerIssue[]>(
    [],
  )

  const handleOk = () => {
    setAnalyzing(true)

    fetchApi({
      url: endpoints.task.analyze,
      method: MethodHTTP.POST,
      body: { id: task?.id, robot: selectedRobot },
    })
      .then((res) => {
        setAnalyzeResults(res.issues || [])
        toast.success(MessageText.analyzedTask)
        setTaskAnalyzed(true)
      })
      .finally(() => {
        setAnalyzing(true)
      })
  }

  /*
      const handleAnalyzeOld = async (task: TaskType) => {
        // Always fetch the task detail to get the code property
        try {
          const detail = await fetchApi({
            url: endpoints.home.libraries.task + `?id=${task.id}`,
            method: MethodHTTP.GET,
          })
          const code = detail?.code
          if (!code) {
            toast.error('No task code found for analysis')
            return
          }
          const blockly = typeof code === 'string' ? JSON.parse(code) : code
          const abstract: any = blocklyToAbstract(blockly)
          // Map objects, locations, actions to analyzer types
          abstract.objects =
            allObjects?.map((obj) => ({
              id: obj.id.toString(),
              name: obj.name,
              // @ts-expect-error: weight may exist in backend data
              weight: obj.weight ?? undefined,
              // @ts-expect-error: dimensions may exist in backend data
              dimensions: obj.dimensions ?? undefined,
            })) || []
          abstract.locations =
            allLocations?.map((loc) => ({
              id: loc.id.toString(),
              name: loc.name,
              // @ts-expect-error: distance may exist in backend data
              distance: loc.distance ?? undefined,
            })) || []
          abstract.actions =
            allActions?.map((act) => ({ id: act.id.toString(), name: act.name })) ||
            []
          // Optionally, add robot info if available
          const results = analyzeAbstractTask(abstract)
          // setAnalyzeResults(results)
          setAnalyzingTask(task)
          setAnalyzeModalVisible(true)
        } catch {
          toast.error('Failed to analyze task')
        }
      }
        */

  return (
    <Modal
      title={`Analyze task ${task?.name}`}
      open={open}
      onOk={handleOk}
      okText="Analyze"
      okButtonProps={{ disabled: !selectedRobot, loading: analyzing }}
      onCancel={() => {
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

      {taskAnalyzed &&
        (analyzeResults.length === 0 ? (
          <p style={{ color: 'green' }}>No issues found. Task is valid!</p>
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
