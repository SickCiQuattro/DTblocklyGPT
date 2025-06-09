import React from 'react'
import { Modal } from 'antd'
import { MethodHTTP, fetchApi } from 'services/api'
import { endpoints } from 'services/endpoints'
import { toast } from 'react-toastify'
import { MessageText } from 'utils/messages'
import { MyRobotType } from 'pages/myrobots/types'
import {
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
} from '@mui/material'
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
      })
      .finally(() => {
        setRunning(false)
      })
  }

  return (
    <Modal
      title={`Run task: ${task?.name}`}
      open={open}
      onOk={handleOk}
      okText="Run"
      okButtonProps={{ disabled: !selectedRobot, loading: running }}
      onCancel={() => {
        handleClose()
        setSelectedRobot('')
      }}
      cancelButtonProps={{ style: { float: 'left' } }}
      maskClosable={false}
      closeIcon={null}
    >
      <p>Are you sure to run this task?</p>
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
        label="Simulate condition events"
        title="Simulate condition events for debug purpose"
      />
    </Modal>
  )
}
