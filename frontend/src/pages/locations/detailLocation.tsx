import React from 'react'
import { Button, CircularProgress, Stack, Typography } from '@mui/material'
import { useNavigate, useParams } from 'react-router-dom'
import useSWR from 'swr'
import { useDispatch } from 'react-redux'

import { MainCard } from 'components/MainCard'
import { endpoints } from 'services/endpoints'
import { activeItem } from 'store/reducers/menu'
import { MyRobotType } from 'pages/myrobots/types'
import { useDocumentTitle } from 'hooks/useDocumentTitle'

import { FormLocation } from './formLocation'
import { LocationDetailType } from './types'

const DetailLocation = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const insertMode = id === 'add'
  useDocumentTitle(insertMode ? 'Add Location' : 'Location Detail')
  const {
    data: dataLocation,
    error: locationError,
    isLoading: isLoadingLocation,
    mutate: mutateLocation,
  } = useSWR<LocationDetailType, Error>(
    !insertMode
      ? { url: endpoints.home.libraries.location, body: { id } }
      : null,
  )

  const backFunction = () => {
    void dispatch(activeItem('locations'))
    void navigate('/locations')
  }

  const { data: dataMyRobots, isLoading: isLoadingMyRobots } = useSWR<
    MyRobotType[],
    Error
  >({
    url: endpoints.home.libraries.myRobots,
  })

  const isLoading = isLoadingLocation || isLoadingMyRobots
  const data = dataLocation && dataMyRobots
  const loadError = !insertMode && !isLoadingLocation && !!locationError
  const notFound =
    !insertMode &&
    !isLoadingLocation &&
    !locationError &&
    dataLocation === undefined

  const subtitle = insertMode
    ? 'Here you can define the details of the Location. Hover over fields to see their descriptions.'
    : 'Here you can edit the details of the Location. Hover over fields to see their descriptions.'

  return (
    <MainCard
      title={insertMode ? 'Add Location' : 'Location Detail'}
      subtitle={subtitle}
      backFunction={backFunction}
      backTitle="Return to Locations"
    >
      {isLoading && !insertMode && <CircularProgress />}
      {loadError && (
        <Stack spacing={1.5} sx={{ alignItems: 'center', py: 4 }}>
          <Typography variant="body2" color="error.dark">
            Couldn&apos;t load this location. Check your connection and try
            again.
          </Typography>
          <Button size="small" onClick={() => mutateLocation()}>
            Retry
          </Button>
        </Stack>
      )}
      {notFound && <Typography>Location with ID {id} not found</Typography>}
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
