import { useState } from 'react'
import { useMediaQuery } from '@mui/material'
import { useSelector } from 'react-redux'
import * as Blockly from 'blockly/core'

import { BlocklyEditor } from 'features/blockly'
import { useViewSettings } from 'features/blockly/utils/useViewSettings'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { ActionListType } from 'pages/actions/types'
import { TaskDetailType, TaskType } from 'pages/tasks/types'
import { RootState } from 'store/reducers'
import { BlockState as State } from 'utils/blocklyTypes'

import { RightPanel } from './rightPanel'

interface SplittedLayoutProps {
  dataLocations: LocationListType[]
  dataObjects: ObjectListType[]
  dataActions: ActionListType[]
  dataMacros: TaskType[]
  currentTaskId?: number
  dataTask: State | null
  backFunction: () => void
  macroDetailsById: Record<number, TaskDetailType>
}

export const SplittedLayout = ({
  dataLocations,
  dataObjects,
  dataActions,
  dataMacros,
  currentTaskId,
  dataTask,
  backFunction,
  macroDetailsById,
}: SplittedLayoutProps) => {
  const { editMode } = useSelector((state: RootState) => state.task)
  const isBigScreen = useMediaQuery('(min-width: 1700px)')
  const height = isBigScreen ? '75vh' : '66vh'
  const [workspace, setWorkspace] = useState<Blockly.WorkspaceSvg | null>(null)

  const { viewSettings, updateViewSettings, resetViewSettings } =
    useViewSettings()

  return (
    <div style={{ display: 'flex', height }}>
      <BlocklyEditor
        dataLocations={dataLocations}
        dataObjects={dataObjects}
        dataActions={dataActions}
        dataMacros={dataMacros}
        currentTaskId={currentTaskId}
        dataTask={dataTask}
        editMode={editMode}
        onWorkspaceReady={setWorkspace}
        blockViewMode={viewSettings.blockViewMode}
        deleteConfirmMode={viewSettings.deleteConfirmMode}
        showStartBlock={viewSettings.showStartBlock}
        macroDetailsById={macroDetailsById}
      />

      <RightPanel
        backFunction={backFunction}
        dataTask={dataTask}
        workspace={workspace}
        viewSettings={viewSettings}
        onViewSettingsChange={updateViewSettings}
        onResetViewSettings={resetViewSettings}
      />
    </div>
  )
}
