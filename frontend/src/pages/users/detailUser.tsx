import React from 'react'
import { CircularProgress, Typography } from '@mui/material'
import { useNavigate, useParams } from 'react-router-dom'
import useSWR from 'swr'
import { useDispatch } from 'react-redux'

import { MainCard } from 'components/MainCard'
import { endpoints } from 'services/endpoints'
import { activeItem } from 'store/reducers/menu'
import { FormUser } from './formUser'
import { RoleType, UserDetailType } from './types'

const DetailUser = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const insertMode = id === 'add'
  const { data: dataUser, isLoading: isLoadingUser } = useSWR<
    UserDetailType,
    Error
  >(!insertMode ? { url: endpoints.home.management.user, body: { id } } : null)

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

  const subtitle = insertMode
    ? 'Here you can define the detail of the User. Stay hover the fields to see the description.'
    : 'Here you can edit the detail of the User. Stay hover the fields to see the description.'

  return (
    <MainCard
      title={insertMode ? 'Add user' : 'User detail'}
      subtitle={subtitle}
      backFunction={backFunction}
      backTitle="Return to the list of users"
    >
      {isLoading && !insertMode && <CircularProgress />}
      {data === null && <Typography>User with ID {id} not found</Typography>}
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
