import { useEffect, useState } from 'react'
import { fetchApi } from 'services/api'
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
import {
  AbstractStep,
  TaskDetailType,
  TaskStatus,
  TaskType,
  isPublished,
  isMacroTask,
} from 'pages/tasks/types'
import { abstractToBlockly } from 'utils/blocklyParser'
import { toggleEditMode } from 'store/reducers/task'
import { BlockState as State } from 'utils/blocklyTypes'

import { SplittedLayout } from './splittedLayout'

const isBlockState = (value: unknown): value is State =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  typeof (value as { type?: unknown }).type === 'string'

const Graphic = () => {
  const { id } = useParams()
  const currentTaskId =
    id !== undefined && !Number.isNaN(Number(id)) ? Number(id) : undefined
  const navigate = useNavigate()
  const dispatch = useDispatch()

  const {
    data: dataTask,
    isLoading: isLoadingTask,
    mutate: mutateTask,
  } = useSWR<
    { name: string; code: Record<string, unknown> | null; status: TaskStatus },
    Error
  >({ url: endpoints.graphic.getGraphicTask, body: { id } })

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

  const { data: tasks } = useSWR<TaskType[], Error>({
    url: endpoints.home.libraries.tasks,
  })

  const dataMacros = (tasks ?? []).filter(
    (t) => isMacroTask(t) && isPublished(t) && t.id !== currentTaskId,
  )

  const [macroDetailsById, setMacroDetailsById] = useState<
    Record<number, TaskDetailType>
  >({})

  useEffect(() => {
    if (dataMacros.length === 0) return
    const ids = dataMacros.map((m) => m.id)
    Promise.all(
      ids.map((macroId) =>
        fetchApi<TaskDetailType>({
          url: endpoints.home.libraries.task,
          body: { id: macroId },
        }),
      ),
    ).then((results) => {
      const map: Record<number, TaskDetailType> = {}
      results.forEach((detail, i) => {
        if (detail) map[ids[i]] = detail
      })
      setMacroDetailsById(map)
    })
  }, [dataMacros.length])

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
    dataTask !== undefined &&
    dataObjects !== undefined &&
    dataActions !== undefined &&
    dataLocations !== undefined

  const isLoading =
    isLoadingTask || isLoadingObjects || isLoadingActions || isLoadingLocations

  const parsedTaskCode = dataTask?.code ?? null

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
          currentTaskId={currentTaskId}
          dataTask={normalizedTaskCode}
          backFunction={backFunction}
          macroDetailsById={macroDetailsById}
          taskStatus={dataTask?.status ?? 'draft'}
          onLifecycleChange={() => void mutateTask()}
        />
      )}
    </MainCard>
  )
}

export default Graphic
