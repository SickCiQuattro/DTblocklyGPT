import { useEffect } from 'react'
import { CircularProgress, Typography } from '@mui/material'
import { useNavigate, useParams } from 'react-router-dom'
import useSWR from 'swr'
import { useDispatch } from 'react-redux'
import { activeItem, openDrawer } from 'store/reducers/menu'
import { MainCard } from 'components/MainCard'
import { endpoints } from 'services/endpoints'
import { ObjectListType } from 'pages/objects/types'
import { LocationListType } from 'pages/locations/types'
import { ActionListType } from 'pages/actions/types'
import { SplittedLayout } from './splittedLayout'
import { abstractToBlockly } from 'utils/blocklyParser'
import { toggleEditMode } from 'store/reducers/task'

const Graphic = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()

  const { data: dataTask, isLoading: isLoadingTask } = useSWR<
    { name: string; code: string },
    Error
  >({
    url: endpoints.graphic.getGraphicTask,
    body: { id },
  })
  const { data: dataObjects, isLoading: isLoadingObjects } = useSWR<
    ObjectListType[],
    Error
  >({
    url: endpoints.graphic.objectsGraphic,
  })
  const { data: dataActions, isLoading: isLoadingActions } = useSWR<
    ActionListType[],
    Error
  >({
    url: endpoints.graphic.actionsGraphic,
  })
  const { data: dataLocations, isLoading: isLoadingLocations } = useSWR<
    LocationListType[],
    Error
  >({
    url: endpoints.graphic.locationsGraphic,
  })

  const title = dataTask
    ? `Graphic interface to edit the task: "${dataTask.name}"`
    : ''

  const backFunction = () => {
    dispatch(openDrawer(true))
    dispatch(toggleEditMode())
    dispatch(activeItem('tasks'))
    navigate('/tasks')
  }

  const data = dataTask && dataObjects && dataActions && dataLocations
  const isLoading =
    isLoadingTask || isLoadingObjects || isLoadingActions || isLoadingLocations

  useEffect(() => {
    if (dataTask) dispatch(openDrawer(false))
  }, [dataTask])

  return (
    <MainCard title={title} backFunction={backFunction}>
      {isLoading && <CircularProgress />}
      {dataTask === null && (
        <Typography>Task with ID {id} not found</Typography>
      )}
      {data && (
        <SplittedLayout
          dataObjects={dataObjects}
          dataLocations={dataLocations}
          dataActions={dataActions}
          dataTask={
            dataTask.code
              ? abstractToBlockly(
                  JSON.parse(dataTask.code),
                  dataObjects,
                  dataLocations,
                  dataActions,
                )
              : null
          }
          backFunction={backFunction}
        />
      )}
    </MainCard>
  )
}

export default Graphic
