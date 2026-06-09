import { useEffect, useMemo } from 'react'
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
  TaskType,
} from 'pages/tasks/types'
import { blocklyToAbstractAll, CustomBlock } from 'utils/blocklyParser'

import { SplittedLayout } from './splittedLayout'

const isBlockState = (value: unknown): value is CustomBlock =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  typeof (value as { type?: unknown }).type === 'string' &&
  (String((value as any).type).endsWith('_block') || String((value as any).type) === 'when_start')

const isBlockStateArray = (value: unknown): value is CustomBlock[] =>
  Array.isArray(value) && value.length > 0 && value.every(isBlockState)

const Multimodal = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()

  const { data: dataTask, isLoading: isLoadingTask } = useSWR<
    { name: string; code: Record<string, unknown> | null },
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

  const { data: dataMacros = [], isLoading: isLoadingMacros } = useSWR<TaskType[], Error>(
    { url: endpoints.graphic.macroList },
  )

  const title = dataTask
    ? `Multimodal interface for the task: "${dataTask.name}"`
    : ''

  const backFunction = () => {
    void dispatch(openDrawer(true))
    void dispatch(activeItem('tasks'))
    void navigate('/tasks')
  }

  const currentTaskId =
    id !== undefined && !Number.isNaN(Number(id)) ? Number(id) : undefined

  const filteredMacros = useMemo(
    () => dataMacros.filter((m) => m.id !== currentTaskId),
    [dataMacros, currentTaskId],
  )

  const macroDetailsById = useMemo(
    (): Record<number, TaskDetailType> =>
      Object.fromEntries(
        filteredMacros.map((m) => [
          m.id,
          {
            id: m.id,
            name: m.name,
            description: m.description,
            shared: m.shared,
            status: m.status,
            task_type: m.task_type,
            signature: m.signature,
            code: m.published_workspace ?? null,
          } satisfies TaskDetailType,
        ]),
      ),
    [filteredMacros],
  )

  const data = dataTask && dataObjects && dataActions && dataLocations
  const isLoading =
    isLoadingTask ||
    isLoadingObjects ||
    isLoadingActions ||
    isLoadingLocations ||
    isLoadingMacros

  const parsedTaskCode = dataTask?.code ?? null
  const abstractTaskCode: AbstractStep[] =
    parsedTaskCode === null
      ? []
      : isBlockStateArray(parsedTaskCode)
        ? (blocklyToAbstractAll(parsedTaskCode as CustomBlock[] | null).find(b => b.isMain)?.steps ?? [])
        : Array.isArray(parsedTaskCode)
          ? (parsedTaskCode as AbstractStep[])
          : isBlockState(parsedTaskCode)
            ? (blocklyToAbstractAll(parsedTaskCode as CustomBlock | null).find(b => b.isMain)?.steps ?? [])
            : []

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
          dataMacros={filteredMacros}
          macroDetailsById={macroDetailsById}
          currentTaskId={currentTaskId}
          abstractTask={abstractTaskCode}
          backFunction={backFunction}
        />
      )}
    </MainCard>
  )
}

export default Multimodal
