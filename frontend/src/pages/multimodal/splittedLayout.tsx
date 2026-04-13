import React, { useState, useMemo } from 'react'
import { useMediaQuery } from '@mui/material'
import {
  CloseOutlined,
  EditOutlined,
  SaveOutlined,
  SoundOutlined,
} from '@ant-design/icons'
import { useDispatch } from 'react-redux'
import { toast } from 'react-toastify'
import { useParams } from 'react-router-dom'

import { BlocklyEditor, getBlocklyStructure } from 'features/blockly'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { ActionListType } from 'pages/actions/types'
import { AbstractStep, TaskType } from 'pages/tasks/types'
import { BlockState as State } from 'utils/blocklyTypes'
import {
  abstractToBlockly,
  blocklyToAbstract,
  CustomBlock,
} from 'utils/blocklyParser'
import { Palette } from 'themes/palette'
import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { MessageText } from 'utils/messages'
import { toggleEditMode } from 'store/reducers/task'

import { ChatWrapper } from './chatWrapper'
import { RightPanel } from './rightPanel'

interface SplittedLayoutProps {
  dataLocations: LocationListType[]
  dataObjects: ObjectListType[]
  dataActions: ActionListType[]
  dataMacros: TaskType[]
  abstractTask: AbstractStep[]
  backFunction: () => void
}

const isBlockState = (value: unknown): value is State =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  typeof (value as { type?: unknown }).type === 'string'

export const SplittedLayout = ({
  dataLocations,
  dataObjects,
  dataActions,
  dataMacros,
  abstractTask,
  backFunction,
}: SplittedLayoutProps) => {
  const isBigScreen = useMediaQuery('(min-width: 1700px)')
  const height = isBigScreen ? '70vh' : '60vh'
  const [taskStructure, setTaskStructure] = useState<AbstractStep[] | null>(
    abstractTask,
  )
  const [editingMode, setEditingMode] = useState<boolean>(true)
  const [newChatResponse, setNewChatResponse] = useState<boolean>(false)
  const [speaker, setSpeaker] = React.useState(false)
  const themePalette = Palette('light')
  const dispatch = useDispatch()
  const { id } = useParams()

  const handleSave = () => {
    const blocklyTaskStructure = getBlocklyStructure()
    const abstractTask = blocklyToAbstract(blocklyTaskStructure as CustomBlock)

    void fetchApi({
      url: endpoints.graphic.saveGraphicTask,
      method: MethodHTTP.PUT,
      body: { taskStructure: abstractTask, id },
    }).then(() => {
      toast.success(MessageText.success)
      void dispatch(toggleEditMode())
      backFunction()
    })
  }

  const parsedDataTask = useMemo(() => {
    if (!taskStructure) return null

    const convertedTask = abstractToBlockly(
      taskStructure,
      dataObjects,
      dataLocations,
      dataActions,
    )
    return isBlockState(convertedTask) ? convertedTask : null
  }, [taskStructure, dataObjects, dataLocations, dataActions])

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        {!editingMode && (
          <EditOutlined
            style={{
              fontSize: '2em',
              marginRight: '1rem',
              color: themePalette.palette.warning.main,
            }}
            onClick={() => {
              setEditingMode(true)
            }}
            title="Edit"
          />
        )}
        {editingMode && (
          <SaveOutlined
            style={{
              fontSize: '2em',
              marginRight: '1rem',
              color: themePalette.palette.primary.main,
            }}
            title="Save"
            onClick={handleSave}
          />
        )}
        <CloseOutlined
          style={{
            fontSize: '2em',
            marginRight: '2rem',
            color: editingMode
              ? themePalette.palette.error.main
              : themePalette.palette.grey[300],
            cursor: editingMode ? 'pointer' : 'not-allowed',
          }}
          title="Cancel"
          onClick={() => {
            setEditingMode(false)
            setTaskStructure(abstractTask)
          }}
          disabled={!editingMode}
        />
        <SoundOutlined
          style={{
            fontSize: '2em',
            marginRight: '2rem',
            color: !editingMode
              ? themePalette.palette.grey[300]
              : speaker
                ? themePalette.palette.success.main
                : themePalette.palette.error.main,
            cursor: editingMode ? 'pointer' : 'not-allowed',
          }}
          onClick={() => {
            setSpeaker(!speaker)
          }}
          disabled={!editingMode}
          title="Toggle Speaker"
        />
      </div>
      <div style={{ display: 'flex', height }}>
        <BlocklyEditor
          dataLocations={dataLocations}
          dataObjects={dataObjects}
          dataActions={dataActions}
          dataMacros={dataMacros}
          dataTask={parsedDataTask}
          editMode={editingMode}
          applyExternalTaskState={newChatResponse}
          onExternalTaskStateApplied={() => setNewChatResponse(false)}
          onTaskStructureChange={setTaskStructure}
        />
        {editingMode && (
          <ChatWrapper
            speaker={speaker}
            taskStructure={taskStructure}
            setTaskStructure={setTaskStructure}
            editingMode={editingMode}
            dataLocations={dataLocations}
            dataObjects={dataObjects}
            dataActions={dataActions}
            setNewChatResponse={setNewChatResponse}
          />
        )}
        <RightPanel dataTask={taskStructure} />
      </div>
    </div>
  )
}
