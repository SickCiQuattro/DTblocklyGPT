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

import { FormAction } from './formAction'
import { ActionDetailType } from './types'

const DetailAction = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const insertMode = id === 'add'
  useDocumentTitle(insertMode ? 'Add Skill' : 'Skill Detail')
  const {
    data: dataAction,
    error: actionError,
    isLoading: isLoadingAction,
    mutate: mutateAction,
  } = useSWR<ActionDetailType, Error>(
    !insertMode ? { url: endpoints.home.libraries.action, body: { id } } : null,
  )

  const backFunction = () => {
    void dispatch(activeItem('actions'))
    void navigate('/actions')
  }

  const { data: dataMyRobots, isLoading: isLoadingMyRobots } = useSWR<
    MyRobotType[],
    Error
  >({
    url: endpoints.home.libraries.myRobots,
  })

  const isLoading = isLoadingAction || isLoadingMyRobots
  const data = dataAction && dataMyRobots
  const loadError = !insertMode && !isLoadingAction && !!actionError
  const notFound =
    !insertMode && !isLoadingAction && !actionError && dataAction === undefined

  const subtitle = insertMode
    ? 'Here you can define the details of the Skill. Hover over fields to see their descriptions.'
    : 'Here you can edit the details of the Skill. Hover over fields to see their descriptions.'

  return (
    <MainCard
      title={insertMode ? 'Add Skill' : 'Skill Detail'}
      subtitle={subtitle}
      backFunction={backFunction}
      backTitle="Return to Skills"
    >
      {isLoading && !insertMode && <CircularProgress />}
      {loadError && (
        <Stack spacing={1.5} sx={{ alignItems: 'center', py: 4 }}>
          <Typography variant="body2" color="error.dark">
            Couldn&apos;t load this skill. Check your connection and try again.
          </Typography>
          <Button size="small" onClick={() => mutateAction()}>
            Retry
          </Button>
        </Stack>
      )}
      {notFound && <Typography>Skill with ID {id} not found</Typography>}
      {(data || insertMode) && (
        <FormAction
          dataAction={dataAction}
          dataMyRobots={dataMyRobots || []}
          insertMode={insertMode}
          backFunction={backFunction}
        />
      )}
    </MainCard>
  )
}

export default DetailAction
