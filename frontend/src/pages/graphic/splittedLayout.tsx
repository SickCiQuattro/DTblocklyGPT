import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { ActionListType } from 'pages/actions/types'
import { useMediaQuery } from '@mui/material'
import { State } from 'blockly/core/serialization/blocks'
import { RightPanel } from './rightPanel'
import { CustomDragDrop } from './CustomDragDrop'

interface SplittedLayoutProps {
  dataLocations: LocationListType[]
  dataObjects: ObjectListType[]
  dataActions: ActionListType[]
  dataTask: State
  backFunction: () => void
}

export const SplittedLayout = ({
  dataLocations,
  dataObjects,
  dataActions,
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
        dataTask={dataTask}
      />
      <RightPanel backFunction={backFunction} dataTask={dataTask} />
    </div>
  )
}
