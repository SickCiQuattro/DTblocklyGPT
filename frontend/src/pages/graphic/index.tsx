import { useMemo, useEffect } from 'react'
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
  TaskTypeField,
} from 'pages/tasks/types'
import { abstractToBlockly } from 'utils/blocklyParser'
import { toggleEditMode } from 'store/reducers/task'
import { BlockState as State } from 'utils/blocklyTypes'

import { SplittedLayout } from './splittedLayout'

const isBlockState = (value: unknown): value is State =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  typeof (value as { type?: unknown }).type === 'string' &&
  (String((value as any).type).endsWith('_block') || String((value as any).type) === 'when_start')

const isBlockStateArray = (value: unknown): value is State[] =>
  Array.isArray(value) && value.length > 0 && value.every(isBlockState)

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
    {
      name: string
      code: Record<string, unknown> | null
      status: TaskStatus
      task_type: TaskTypeField
    },
    Error
  >({ url: endpoints.graphic.getGraphicTask, body: { id } })

  const { data: dataObjects, isLoading: isLoadingObjects } = useSWR<
    ObjectListType[],
    Error
  >({ url: endpoints.graphic.objectsGraphic })

  const { data: dataActions, isLoading: isLoadingActions } = useSWR<
    ActionListType[],
    Error
  >({ url: endpoints.graphic.actionsGraphic })

  const { data: dataLocations, isLoading: isLoadingLocations } = useSWR<
    LocationListType[],
    Error
  >({ url: endpoints.graphic.locationsGraphic })

  const {
    data: dataMacros = [],
    isLoading: isLoadingMacros,
    mutate: mutateMacros,
  } = useSWR<TaskType[], Error>(
    { url: endpoints.graphic.macroList },
  )

  // Derive macroDetailsById directly from dataMacros — no second fetch needed.
  // published_workspace is returned by macroList and used for block explosion
  // (break-into-steps) and tooltip preview.
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
            // published_workspace is returned by get_macro_list and used for
            // block explosion + preview.
            code: m.published_workspace ?? null,
          } satisfies TaskDetailType,
        ]),
      ),
    [filteredMacros],
  )

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
    isLoadingTask ||
    isLoadingObjects ||
    isLoadingActions ||
    isLoadingLocations ||
    isLoadingMacros

  const parsedTaskCode = dataTask?.code ?? null

  const normalizedTaskCode: State | State[] | null =
    parsedTaskCode && Array.isArray(parsedTaskCode)
      ? (() => {
          if (isBlockStateArray(parsedTaskCode)) {
            return parsedTaskCode
          }
          const converted = abstractToBlockly(
            parsedTaskCode as AbstractStep[],
            dataObjects ?? [],
            dataLocations ?? [],
            dataActions ?? [],
          )
          return isBlockState(converted) ? converted : null
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
          dataMacros={filteredMacros}
          currentTaskId={currentTaskId}
          dataTask={normalizedTaskCode}
          backFunction={backFunction}
          macroDetailsById={macroDetailsById}
          taskStatus={dataTask?.status ?? 'draft'}
          onLifecycleChange={() => {
            void mutateTask()
            void mutateMacros()
          }}
        />
      )}
    </MainCard>
  )
}

export default Graphic
