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
import { blocklyToAbstract, CustomBlock } from 'utils/blocklyParser'
import { AbstractStep } from 'pages/tasks/types'

import { SplittedLayout } from './splittedLayout'

const Multimodal = () => {
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
    ? `Multimodal interface for the task: "${dataTask.name}"`
    : ''

  const backFunction = () => {
    void dispatch(openDrawer(true))
    void dispatch(activeItem('tasks'))
    void navigate('/tasks')
  }

  const data = dataTask && dataObjects && dataActions && dataLocations
  const isLoading =
    isLoadingTask || isLoadingObjects || isLoadingActions || isLoadingLocations

  const parseTaskCode = (taskCode: string): unknown => {
    try {
      return JSON.parse(taskCode) as unknown
    } catch {
      return null
    }
  }

  const parsedTaskCode = dataTask ? parseTaskCode(dataTask.code) : null
  const abstractTaskCode: AbstractStep[] =
    parsedTaskCode === null
      ? []
      : Array.isArray(parsedTaskCode)
        ? (parsedTaskCode as AbstractStep[])
        : (blocklyToAbstract(parsedTaskCode as CustomBlock) ?? [])

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
          abstractTask={abstractTaskCode}
          backFunction={backFunction}
        />
      )}
    </MainCard>
  )
}

export default Multimodal
