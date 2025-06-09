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
      })
      .finally(() => {
        setSimulating(false)
      })
  }

  return (
    <Modal
      title={`Simulate task: ${task?.name}`}
      open={open}
      onOk={handleOk}
      okText="Simulate"
      okButtonProps={{
        loading: simulating,
      }}
      onCancel={() => {
        handleClose()
      }}
      cancelButtonProps={{
        style: { float: 'left' },
      }}
      maskClosable={false}
      closeIcon={null}
    >
      <p>Are you sure to simulate this task?</p>
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
        label="WHEN conditions always fulfilled"
        title="WHEN conditions always fulfilled"
      />
    </Modal>
  )
}
