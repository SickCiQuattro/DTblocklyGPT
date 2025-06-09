import React from 'react'
import { CircularProgress, Typography } from '@mui/material'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import useSWR from 'swr'
import { useDispatch } from 'react-redux'

import { MainCard } from 'components/MainCard'
import { endpoints } from 'services/endpoints'
import { activeItem } from 'store/reducers/menu'
import { FormTask, TypeNewTask } from './formTask'
import { TaskDetailType } from './types'

const DetailTask = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const insertMode = id === 'add'

  const [searchParams] = useSearchParams()
  const type = searchParams.get('type')

  const { data, isLoading } = useSWR<TaskDetailType, Error>(
    !insertMode ? { url: endpoints.home.libraries.task, body: { id } } : null,
  )

  const backFunction = () => {
    dispatch(activeItem('tasks'))
    navigate('/tasks')
  }

  const titleNewTask =
    type === TypeNewTask.CHAT
      ? 'New task with chat'
      : 'New task with graphic interface'

  const subtitle = insertMode
    ? 'Here you can define a new task. Stay hover the fields to see the description.'
    : 'Here you can edit the detail of the task. Stay hover the fields to see the description.'

  return (
    <MainCard
      title={!insertMode ? 'Task detail' : titleNewTask}
      subtitle={subtitle}
      backFunction={backFunction}
      backTitle="Return to the list of tasks"
    >
      {isLoading && !insertMode && <CircularProgress />}
      {data === null && <Typography>Task with ID {id} not found</Typography>}
      {(data || insertMode) && (
        <FormTask
          data={data}
          insertMode={insertMode}
          backFunction={backFunction}
        />
      )}
    </MainCard>
  )
}

export default DetailTask
