import React from 'react'
import { Button, CircularProgress, Stack, Typography } from '@mui/material'
import { useNavigate, useParams } from 'react-router-dom'
import useSWR from 'swr'
import { useDispatch } from 'react-redux'

import { MainCard } from 'components/MainCard'
import { endpoints } from 'services/endpoints'
import { activeItem } from 'store/reducers/menu'
import { useDocumentTitle } from 'hooks/useDocumentTitle'

import { FormUser } from './formUser'
import { RoleType, UserDetailType } from './types'

const DetailUser = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const insertMode = id === 'add'
  useDocumentTitle(insertMode ? 'Add User Account' : 'User Account Detail')
  const {
    data: dataUser,
    error: userError,
    isLoading: isLoadingUser,
    mutate: mutateUser,
  } = useSWR<UserDetailType, Error>(
    !insertMode ? { url: endpoints.home.management.user, body: { id } } : null,
  )

  const backFunction = () => {
    dispatch(activeItem('users'))
    navigate('/users')
  }

  const { data: dataRoles, isLoading: isLoadingRoles } = useSWR<
    RoleType[],
    Error
  >({
    url: endpoints.home.management.groups,
  })

  const isLoading = isLoadingUser || isLoadingRoles
  const data = dataUser && dataRoles
  const loadError = !insertMode && !isLoadingUser && !!userError
  const notFound =
    !insertMode && !isLoadingUser && !userError && dataUser === undefined

  const subtitle = insertMode
    ? 'Here you can define the details of the user account. Hover over fields to see their descriptions.'
    : 'Here you can edit the details of the user account. Hover over fields to see their descriptions.'

  return (
    <MainCard
      title={insertMode ? 'Add User Account' : 'User Account Detail'}
      subtitle={subtitle}
      backFunction={backFunction}
      backTitle="Return to User Accounts"
    >
      {isLoading && !insertMode && <CircularProgress />}
      {loadError && (
        <Stack spacing={1.5} sx={{ alignItems: 'center', py: 4 }}>
          <Typography variant="body2" color="error.dark">
            Couldn&apos;t load this user account. Check your connection and try
            again.
          </Typography>
          <Button size="small" onClick={() => mutateUser()}>
            Retry
          </Button>
        </Stack>
      )}
      {notFound && <Typography>User Account with ID {id} not found</Typography>}
      {(data || insertMode) && (
        <FormUser
          dataUser={dataUser}
          dataRoles={dataRoles || []}
          insertMode={insertMode}
          backFunction={backFunction}
        />
      )}
    </MainCard>
  )
}

export default DetailUser
