import React, { useState } from 'react'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { ActionListType } from 'pages/actions/types'
import { useMediaQuery } from '@mui/material'
import { RightPanel } from './rightPanel'
import { CustomDragDrop } from './CustomDragDrop'
import { ChatWrapper } from './chatWrapper'
import { AbstractStep } from 'pages/tasks/types'
import * as Blockly from 'blockly/core'
import {
  abstractToBlockly,
  blocklyToAbstract,
  CustomBlock,
} from 'utils/blocklyParser'
import {
  CloseOutlined,
  EditOutlined,
  RedoOutlined,
  SaveOutlined,
  SoundOutlined,
  UndoOutlined,
} from '@ant-design/icons'
import { Palette } from 'themes/palette'
import { useDispatch } from 'react-redux'
import { getBlocklyStructure } from './CustomDragDrop/Blockly/BlocklyComponent'
import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { toast } from 'react-toastify'
import { MessageText } from 'utils/messages'
import { toggleEditMode } from 'store/reducers/task'
import { useParams, useSearchParams } from 'react-router-dom'

interface SplittedLayoutProps {
  dataLocations: LocationListType[]
  dataObjects: ObjectListType[]
  dataActions: ActionListType[]
  abstractTask: AbstractStep[]
  backFunction: () => void
}

export const SplittedLayout = ({
  dataLocations,
  dataObjects,
  dataActions,
  abstractTask,
  backFunction,
}: SplittedLayoutProps) => {
  const isBigScreen = useMediaQuery('(min-width: 1700px)')
  const height = isBigScreen ? '70vh' : '60vh'
  const [taskStructure, setTaskStructure] =
    useState<AbstractStep[]>(abstractTask)
  const [searchParams] = useSearchParams()
  const newTaskParam = searchParams.get('newTask')
  const [editingMode, setEditingMode] = useState<boolean>(
    newTaskParam === 'true',
  )
  const [speaker, setSpeaker] = React.useState(false)
  const themePalette = Palette('light')
  const dispatch = useDispatch()
  const { id } = useParams()

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
        <UndoOutlined
          style={{
            fontSize: '2em',
            marginRight: '1rem',
            color:
              editingMode &&
              Blockly.getMainWorkspace() &&
              Blockly.getMainWorkspace().getUndoStack().length > 0
                ? themePalette.palette.primary.main
                : themePalette.palette.grey[300],
            cursor:
              editingMode &&
              Blockly.getMainWorkspace() &&
              Blockly.getMainWorkspace().getUndoStack().length > 0
                ? 'pointer'
                : 'not-allowed',
          }}
          title="Undo"
          disabled={
            !editingMode ||
            (Blockly.getMainWorkspace() &&
              Blockly.getMainWorkspace().getUndoStack().length === 0)
          }
          onClick={() => {
            Blockly.getMainWorkspace().undo(false)
            const blocklyTaskStructure = getBlocklyStructure()
            const abstractTask = blocklyToAbstract(
              blocklyTaskStructure as CustomBlock,
            )
            if (!abstractTask) return
            setTaskStructure(abstractTask)
          }}
        />
        <RedoOutlined
          style={{
            fontSize: '2em',
            marginRight: '2rem',
            color:
              editingMode &&
              Blockly.getMainWorkspace() &&
              Blockly.getMainWorkspace().getRedoStack().length > 0
                ? themePalette.palette.primary.main
                : themePalette.palette.grey[300],
            cursor:
              editingMode &&
              Blockly.getMainWorkspace() &&
              Blockly.getMainWorkspace().getRedoStack().length > 0
                ? 'pointer'
                : 'not-allowed',
          }}
          title="Redo"
          disabled={
            !editingMode ||
            (Blockly.getMainWorkspace() &&
              Blockly.getMainWorkspace().getRedoStack().length === 0)
          }
          onClick={() => {
            Blockly.getMainWorkspace().undo(true)
            const blocklyTaskStructure = getBlocklyStructure()
            const abstractTask = blocklyToAbstract(
              blocklyTaskStructure as CustomBlock,
            )
            if (!abstractTask) return
            setTaskStructure(abstractTask)
          }}
        />
        <SoundOutlined
          style={{
            fontSize: '2em',
            marginRight: '1rem',
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
        <CustomDragDrop
          dataLocations={dataLocations}
          dataObjects={dataObjects}
          dataActions={dataActions}
          editingMode={editingMode}
          dataTask={
            abstractTask
              ? abstractToBlockly(
                  abstractTask,
                  dataObjects,
                  dataLocations,
                  dataActions,
                )
              : null
          }
          setTaskStructure={setTaskStructure}
        />
        {/* {editingMode && ( */}
        <ChatWrapper
          speaker={speaker}
          taskStructure={taskStructure}
          setTaskStructure={setTaskStructure}
          editingMode={editingMode}
          dataLocations={dataLocations}
          dataObjects={dataObjects}
          dataActions={dataActions}
        />
        {/* )} */}
        <RightPanel dataTask={taskStructure} />
      </div>
    </div>
  )
}
