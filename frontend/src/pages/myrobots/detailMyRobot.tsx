import React from 'react'
import { CircularProgress, Typography } from '@mui/material'
import { useNavigate, useParams } from 'react-router-dom'
import useSWR from 'swr'
import { useDispatch } from 'react-redux'

import { MainCard } from 'components/MainCard'
import { endpoints } from 'services/endpoints'
import { activeItem } from 'store/reducers/menu'
import { RobotType } from 'pages/robots/types'

import { FormMyRobot } from './formMyRobot'
import { MyRobotDetailType } from './types'

const DetailMyRobot = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const insertMode = id === 'add'
  const { data: dataMyRobot, isLoading: isLoadingMyRobot } = useSWR<
    MyRobotDetailType,
    Error
  >(
    !insertMode
      ? { url: endpoints.home.libraries.myRobot, body: { id } }
      : null,
  )

  const backFunction = () => {
    void dispatch(activeItem('myrobots'))
    void navigate('/myrobots')
  }

  const { data: dataRobots, isLoading: isLoadingRobots } = useSWR<
    RobotType[],
    Error
  >({
    url: endpoints.home.management.robots,
  })

  const isLoading = isLoadingRobots || isLoadingMyRobot
  const data = dataRobots && dataMyRobot

  const subtitle = insertMode
    ? 'Here you can define the details of your personal robot. Hover over fields to see their descriptions.'
    : 'Here you can edit the details of your personal robot. Hover over fields to see their descriptions.'

  return (
    <MainCard
      title={insertMode ? 'Add My Robot' : 'My Robot Detail'}
      subtitle={subtitle}
      backFunction={backFunction}
      backTitle="Return to My Robot"
    >
      {isLoading && !insertMode && <CircularProgress />}
      {data === null && (
        <Typography>My Robot with ID {id} not found</Typography>
      )}
      {(data || insertMode) && (
        <FormMyRobot
          dataMyRobot={dataMyRobot}
          dataRobots={dataRobots || []}
          insertMode={insertMode}
          backFunction={backFunction}
        />
      )}
    </MainCard>
  )
}

export default DetailMyRobot
