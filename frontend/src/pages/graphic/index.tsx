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
import { TaskType } from 'pages/tasks/types'
import { abstractToBlockly } from 'utils/blocklyParser'
import { toggleEditMode } from 'store/reducers/task'
import { AbstractStep } from 'pages/tasks/types'
import { BlockState as State } from 'utils/blocklyTypes'

import { SplittedLayout } from './splittedLayout'

const isBlockState = (value: unknown): value is State =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  typeof (value as { type?: unknown }).type === 'string'

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

  const { data: dataMacros, isLoading: isLoadingMacros } = useSWR<
    TaskType[],
    Error
  >({
    url: endpoints.home.libraries.tasks,
  })

  const title = dataTask
    ? `Graphic interface to edit the task: "${dataTask.name}"`
    : ''

  const backFunction = () => {
    void dispatch(openDrawer(true))
    void dispatch(toggleEditMode())
    void dispatch(activeItem('tasks'))
    void navigate('/tasks')
  }

  const data =
    dataTask && dataObjects && dataActions && dataLocations && dataMacros

  const isLoading =
    isLoadingTask ||
    isLoadingObjects ||
    isLoadingActions ||
    isLoadingLocations ||
    isLoadingMacros

  const parseTaskCode = (taskCode: string): unknown => {
    try {
      return JSON.parse(taskCode) as unknown
    } catch {
      return null
    }
  }

  const parsedTaskCode = dataTask ? parseTaskCode(dataTask.code) : null

  const normalizedTaskCode: State | null =
    parsedTaskCode && Array.isArray(parsedTaskCode)
      ? (() => {
          const convertedTaskCode = abstractToBlockly(
            parsedTaskCode as AbstractStep[],
            dataObjects || [],
            dataLocations || [],
            dataActions || [],
          )
          return isBlockState(convertedTaskCode) ? convertedTaskCode : null
        })()
      : isBlockState(parsedTaskCode)
        ? parsedTaskCode
        : null

  useEffect(() => {
    if (dataTask) dispatch(openDrawer(false))
  }, [dataTask, dispatch])

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
          dataMacros={dataMacros}
          dataTask={normalizedTaskCode}
          backFunction={backFunction}
        />
      )}
    </MainCard>
  )
}

export default Graphic
