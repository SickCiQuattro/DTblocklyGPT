import { useMediaQuery } from '@mui/material'

import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { ActionListType } from 'pages/actions/types'
import { TaskType } from 'pages/tasks/types'
import { BlockState as State } from 'utils/blocklyTypes'

import { RightPanel } from './rightPanel'
import { CustomDragDrop } from './CustomDragDrop'

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
  const isBigScreen = useMediaQuery('(min-width: 1700px)')
  const height = isBigScreen ? '75vh' : '66vh'

  return (
    <div style={{ display: 'flex', height }}>
      <CustomDragDrop
        dataLocations={dataLocations}
        dataObjects={dataObjects}
        dataActions={dataActions}
        dataMacros={dataMacros}
        dataTask={dataTask}
      />
      <RightPanel backFunction={backFunction} dataTask={dataTask} />
    </div>
  )
}
