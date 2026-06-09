import React from 'react'
import { CircularProgress, Typography } from '@mui/material'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import useSWR from 'swr'
import { useDispatch } from 'react-redux'

import { MainCard } from 'components/MainCard'
import { endpoints } from 'services/endpoints'
import { activeItem } from 'store/reducers/menu'

import { FormTask, TypeNewTask } from './formTask'
import { TaskDetailType, TaskTypeField } from './types'

const DetailTask = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const insertMode = id === 'add'

  const [searchParams] = useSearchParams()
  const type = searchParams.get('type')
  const taskTypeProp = (searchParams.get('taskType') as TaskTypeField) ?? 'task'

  const { data, isLoading } = useSWR<TaskDetailType, Error>(
    !insertMode ? { url: endpoints.home.libraries.task, body: { id } } : null,
  )

  const backFunction = () => {
    dispatch(activeItem('tasks'))
    navigate('/tasks')
  }

  const titleNewTask =
    type === TypeNewTask.CHAT
      ? 'New Task with Chat'
      : 'New Task with Graphic Interface'

  const subtitle = insertMode
    ? 'Here you can define a new task. Hover over fields to see their descriptions.'
    : 'Here you can edit the details of the task. Hover over fields to see their descriptions.'

  return (
    <MainCard
      title={!insertMode ? 'Task Detail' : titleNewTask}
      subtitle={subtitle}
      backFunction={backFunction}
      backTitle="Return to Tasks"
    >
      {isLoading && !insertMode && <CircularProgress />}
      {data === null && <Typography>Task with ID {id} not found</Typography>}
      {(data || insertMode) && (
        <FormTask
          data={data}
          insertMode={insertMode}
          backFunction={backFunction}
          taskType={taskTypeProp}
        />
      )}
    </MainCard>
  )
}

export default DetailTask
