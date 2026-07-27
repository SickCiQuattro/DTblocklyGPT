import React from 'react'
import { Button, CircularProgress, Stack, Typography } from '@mui/material'
import { useNavigate, useParams } from 'react-router-dom'
import useSWR from 'swr'
import { useDispatch } from 'react-redux'

import { MainCard } from 'components/MainCard'
import { endpoints } from 'services/endpoints'
import { activeItem } from 'store/reducers/menu'
import { useDocumentTitle } from 'hooks/useDocumentTitle'

import { FormRobot } from './formRobot'
import { RobotType } from './types'

const DetailRobot = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const insertMode = id === 'add'
  useDocumentTitle(insertMode ? 'Add Robot to Fleet' : 'Robot Fleet Detail')
  const { data, error, isLoading, mutate } = useSWR<RobotType, Error>(
    !insertMode ? { url: endpoints.home.management.robot, body: { id } } : null,
  )
  const loadError = !insertMode && !isLoading && !!error
  const notFound = !insertMode && !isLoading && !error && data === undefined

  const backFunction = () => {
    dispatch(activeItem('robots'))
    navigate('/robots')
  }

  const subtitle = insertMode
    ? 'Here you can define the details of the robot in the fleet. Hover over fields to see their descriptions.'
    : 'Here you can edit the details of the robot in the fleet. Hover over fields to see their descriptions.'

  return (
    <MainCard
      title={insertMode ? 'Add Robot to Fleet' : 'Robot Fleet Detail'}
      subtitle={subtitle}
      backFunction={backFunction}
      backTitle="Return to Robots Fleet"
    >
      {isLoading && !insertMode && <CircularProgress />}
      {loadError && (
        <Stack spacing={1.5} sx={{ alignItems: 'center', py: 4 }}>
          <Typography variant="body2" color="error.dark">
            Couldn&apos;t load this robot. Check your connection and try again.
          </Typography>
          <Button size="small" onClick={() => mutate()}>
            Retry
          </Button>
        </Stack>
      )}
      {notFound && <Typography>Robot with ID {id} not found</Typography>}
      {(data || insertMode) && (
        <FormRobot
          data={data}
          insertMode={insertMode}
          backFunction={backFunction}
        />
      )}
    </MainCard>
  )
}

export default DetailRobot
