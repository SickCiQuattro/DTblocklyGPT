import React from 'react'
import { Button, CircularProgress, Stack, Typography } from '@mui/material'
import { useNavigate, useParams } from 'react-router-dom'
import useSWR from 'swr'
import { useDispatch } from 'react-redux'

import { MainCard } from 'components/MainCard'
import { endpoints } from 'services/endpoints'
import { activeItem } from 'store/reducers/menu'
import { useDocumentTitle } from 'hooks/useDocumentTitle'

import { FormTask } from './formTask'
import { TaskDetailType } from './types'

const DetailTask = () => {
  useDocumentTitle('Edit Task Details')
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()

  const { data, error, isLoading, mutate } = useSWR<TaskDetailType, Error>({
    url: endpoints.home.libraries.task,
    body: { id },
  })
  const loadError = !isLoading && !!error
  const notFound = !isLoading && !error && data === undefined

  const backFunction = () => {
    dispatch(activeItem('tasks'))
    navigate('/tasks')
  }

  return (
    <MainCard
      title="Edit details"
      subtitle="Name, description, and sharing for this task."
      backFunction={backFunction}
      backTitle="Back to Tasks"
    >
      {isLoading && <CircularProgress />}
      {loadError && (
        <Stack spacing={1.5} sx={{ alignItems: 'center', py: 4 }}>
          <Typography variant="body2" color="error.dark">
            Couldn&apos;t load this task. Check your connection and try again.
          </Typography>
          <Button size="small" onClick={() => mutate()}>
            Retry
          </Button>
        </Stack>
      )}
      {notFound && <Typography>Task with ID {id} not found</Typography>}
      {data && <FormTask data={data} backFunction={backFunction} />}
    </MainCard>
  )
}

export default DetailTask
