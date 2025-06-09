import React from 'react'
import { CircularProgress, Typography } from '@mui/material'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import useSWR from 'swr'
import { useDispatch } from 'react-redux'

import { MainCard } from 'components/MainCard'
import { endpoints } from 'services/endpoints'
import { activeItem } from 'store/reducers/menu'
import { MyRobotType } from 'pages/myrobots/types'
import { FormLocation } from './formLocation'
import { LocationDetailType } from './types'

const DetailLocation = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const [searchParams] = useSearchParams()
  const returnGraphic = searchParams.get('returnGraphic')
  const insertMode = id === 'add'
  const { data: dataLocation, isLoading: isLoadingLocation } = useSWR<
    LocationDetailType,
    Error
  >(
    !insertMode
      ? { url: endpoints.home.libraries.location, body: { id } }
      : null,
  )

  const backFunction = () => {
    if (returnGraphic) {
      navigate(`/graphic/${returnGraphic}`)
      dispatch(activeItem('graphic'))
    } else {
      dispatch(activeItem('locations'))
      navigate('/locations')
    }
  }

  const { data: dataMyRobots, isLoading: isLoadingMyRobots } = useSWR<
    MyRobotType[],
    Error
  >({
    url: endpoints.home.libraries.myRobots,
  })

  const isLoading = isLoadingLocation || isLoadingMyRobots
  const data = dataLocation && dataMyRobots

  const subtitle = insertMode
    ? 'Here you can define the detail of the Location. Stay hover the fields to see the description.'
    : 'Here you can edit the detail of the Location. Stay hover the fields to see the description.'

  return (
    <MainCard
      title={insertMode ? 'Add location' : 'Location detail'}
      subtitle={subtitle}
      backFunction={backFunction}
      backTitle={
        returnGraphic
          ? 'Return to the task graphic'
          : 'Return to the list of locations'
      }
    >
      {isLoading && !insertMode && <CircularProgress />}
      {data === null && (
        <Typography>Location with ID {id} not found</Typography>
      )}
      {(data || insertMode) && (
        <FormLocation
          dataLocation={dataLocation}
          dataMyRobots={dataMyRobots || []}
          insertMode={insertMode}
          backFunction={backFunction}
        />
      )}
    </MainCard>
  )
}

export default DetailLocation
