import React from 'react'
import { CircularProgress, Typography } from '@mui/material'
import { useNavigate, useParams } from 'react-router-dom'
import useSWR from 'swr'
import { useDispatch } from 'react-redux'

import { MainCard } from 'components/MainCard'
import { endpoints } from 'services/endpoints'
import { activeItem } from 'store/reducers/menu'

import { FormTask } from './formTask'
import { TaskDetailType } from './types'

const DetailTask = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()

  const { data, isLoading } = useSWR<TaskDetailType, Error>({
    url: endpoints.home.libraries.task,
    body: { id },
  })

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
      {data === null && <Typography>Task with ID {id} not found</Typography>}
      {data && <FormTask data={data} backFunction={backFunction} />}
    </MainCard>
  )
}

export default DetailTask
