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
import { getFromLocalStorage, LocalStorageKey } from 'utils/localStorageUtils'

import { FormObject } from './formObject'
import { ObjectDetailType } from './types'

const DetailObject = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const insertMode = id === 'add'
  useDocumentTitle(insertMode ? 'Add Object' : 'Object Detail')

  const storedUser: unknown = getFromLocalStorage(LocalStorageKey.USER)
  const currentUserId =
    typeof storedUser === 'object' &&
    storedUser !== null &&
    'id' in storedUser &&
    (typeof storedUser.id === 'string' || typeof storedUser.id === 'number')
      ? String(storedUser.id)
      : null
  const {
    data: dataObject,
    error: objectError,
    isLoading: isLoadingObject,
    mutate: mutateObject,
  } = useSWR<ObjectDetailType, Error>(
    !insertMode ? { url: endpoints.home.libraries.object, body: { id } } : null,
  )

  const backFunction = () => {
    void dispatch(activeItem('objects'))
    void navigate('/objects')
  }

  const { data: dataMyRobots, isLoading: isLoadingMyRobots } = useSWR<
    MyRobotType[],
    Error
  >({
    url: endpoints.home.libraries.myRobots,
  })

  const isLoading = isLoadingObject || isLoadingMyRobots
  const data = dataObject && dataMyRobots
  const loadError = !insertMode && !isLoadingObject && !!objectError
  const notFound =
    !insertMode && !isLoadingObject && !objectError && dataObject === undefined
  const readOnly =
    !insertMode &&
    dataObject !== undefined &&
    currentUserId !== null &&
    String(dataObject.owner) !== currentUserId &&
    dataObject.shared

  const subtitle = insertMode
    ? 'Here you can define the details of the Object. Hover over fields to see their descriptions.'
    : 'Here you can edit the details of the Object. Hover over fields to see their descriptions.'

  return (
    <MainCard
      title={insertMode ? 'Add Object' : 'Object Detail'}
      subtitle={subtitle}
      backFunction={backFunction}
      backTitle="Return to Objects"
    >
      {isLoading && !insertMode && <CircularProgress />}
      {loadError && (
        <Stack spacing={1.5} sx={{ alignItems: 'center', py: 4 }}>
          <Typography variant="body2" color="error.dark">
            Couldn&apos;t load this object. Check your connection and try again.
          </Typography>
          <Button size="small" onClick={() => mutateObject()}>
            Retry
          </Button>
        </Stack>
      )}
      {notFound && <Typography>Object with ID {id} not found</Typography>}
      {(data || insertMode) && (
        <FormObject
          dataObject={dataObject}
          dataMyRobots={dataMyRobots}
          insertMode={insertMode}
          backFunction={backFunction}
          readOnly={readOnly}
          ownerUsername={dataObject?.owner__username}
        />
      )}
    </MainCard>
  )
}

export default DetailObject
