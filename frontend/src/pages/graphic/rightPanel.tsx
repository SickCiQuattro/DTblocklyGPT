import React from 'react'
import { Collapse, Divider } from 'antd'
import { Button, useTheme } from '@mui/material'
import { useDispatch, useSelector } from 'react-redux'
import { MethodHTTP, fetchApi } from 'services/api'
import { endpoints } from 'services/endpoints'
import { toast } from 'react-toastify'
import { MessageText } from 'utils/messages'
import { useParams } from 'react-router-dom'
import {
  CopyOutlined,
  EditOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import { toggleEditMode } from 'store/reducers/task'
import { State } from 'blockly/core/serialization/blocks'

import { getBlocklyStructure } from './CustomDragDrop/Blockly/BlocklyComponent'
import { RootState } from 'store/reducers'
import { blocklyToAbstract, CustomBlock } from 'utils/blocklyParser'

interface RightPanelProps {
  backFunction: () => void
  dataTask: State
}

export const RightPanel = ({ backFunction, dataTask }: RightPanelProps) => {
  const { editMode } = useSelector((state: RootState) => state.task)
  const { id } = useParams()
  const theme = useTheme()
  const dispatch = useDispatch()
  const [actualTask, setActualTask] = React.useState<State | null>(dataTask)

  const handleSave = () => {
    const blocklyTaskStructure = getBlocklyStructure()
    const abstractTask = blocklyToAbstract(blocklyTaskStructure as CustomBlock)

    fetchApi({
      url: endpoints.graphic.saveGraphicTask,
      method: MethodHTTP.PUT,
      body: { taskStructure: abstractTask, id },
    }).then(() => {
      toast.success(MessageText.success)
      dispatch(toggleEditMode())
      backFunction()
    })
  }

  const handleCancel = () => {
    dispatch(toggleEditMode())
  }

  return (
    <div
      style={{
        borderLeft: `1px solid ${theme.palette.grey[300]}`,
        paddingLeft: '1rem',
        width: '33.33%',
        overflow: 'auto',
      }}
    >
      {!editMode && (
        <Button
          fullWidth
          variant="contained"
          startIcon={<EditOutlined />}
          onClick={() => dispatch(toggleEditMode())}
          color="warning"
        >
          Edit
        </Button>
      )}
      {editMode && (
        <>
          <Button
            fullWidth
            variant="contained"
            startIcon={<SaveOutlined />}
            onClick={handleSave}
          >
            Save
          </Button>
          <Button
            fullWidth
            onClick={handleCancel}
            style={{ marginTop: '1rem' }}
          >
            Cancel
          </Button>
        </>
      )}
      <Divider />
      <h2>
        <QuestionCircleOutlined /> Instructions & FAQ
      </h2>
      <p>In this graphic interface you can edit your task.</p>
      <ul>
        <li>
          You can drag the blocks from the panel that appears by clicking on
          each category on the right. Then drag these into the workspace.
        </li>
        <li>
          The allowed interlocks will guide you in creating a formally correct
          task.
        </li>
        <li>Via the right-click menu you can undo/redo your changes.</li>
        <li>
          All changes will be lost if you exit without clicking the <i>Save</i>{' '}
          button.
        </li>
      </ul>
      <Divider />
      <Collapse
        key="task-collapse-debug"
        style={{ marginTop: '1rem', marginRight: '1rem' }}
        items={[
          {
            label: 'Task JSON',
            key: 'task-json',
            children: actualTask ? (
              <pre>
                {JSON.stringify(
                  blocklyToAbstract(actualTask as CustomBlock),
                  null,
                  2,
                )}
              </pre>
            ) : (
              <i>None</i>
            ),
            extra: (
              <>
                <CopyOutlined
                  style={{ marginRight: '1rem' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    navigator.clipboard
                      .writeText(
                        actualTask ? JSON.stringify(actualTask, null, 2) : '',
                      )
                      .then(() => toast.success(MessageText.copiedInClipboard))
                  }}
                />
                <SyncOutlined
                  style={{ marginRight: '1rem' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setActualTask(getBlocklyStructure())
                    toast.success(MessageText.success)
                  }}
                />
              </>
            ),
          },
        ]}
      />
    </div>
  )
}
