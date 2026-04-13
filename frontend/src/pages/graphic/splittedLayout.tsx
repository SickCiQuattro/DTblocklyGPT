import { useMediaQuery } from '@mui/material'
import { useSelector } from 'react-redux'

import { BlocklyEditor } from 'features/blockly'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { ActionListType } from 'pages/actions/types'
import { TaskType } from 'pages/tasks/types'
import { RootState } from 'store/reducers'
import { BlockState as State } from 'utils/blocklyTypes'

import { RightPanel } from './rightPanel'

interface SplittedLayoutProps {
  dataLocations: LocationListType[]
  dataObjects: ObjectListType[]
  dataActions: ActionListType[]
  dataMacros: TaskType[]
  dataTask: State | null
  backFunction: () => void
}

export const SplittedLayout = ({
  dataLocations,
  dataObjects,
  dataActions,
  dataMacros,
  dataTask,
  backFunction,
}: SplittedLayoutProps) => {
  const { editMode } = useSelector((state: RootState) => state.task)
  const isBigScreen = useMediaQuery('(min-width: 1700px)')
  const height = isBigScreen ? '75vh' : '66vh'

  return (
    <div style={{ display: 'flex', height }}>
      <BlocklyEditor
        dataLocations={dataLocations}
        dataObjects={dataObjects}
        dataActions={dataActions}
        dataMacros={dataMacros}
        dataTask={dataTask}
        editMode={editMode}
      />
      <RightPanel backFunction={backFunction} dataTask={dataTask} />
    </div>
  )
}
