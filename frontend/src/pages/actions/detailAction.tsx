import React from 'react'
import { CircularProgress, Typography } from '@mui/material'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import useSWR from 'swr'
import { useDispatch } from 'react-redux'

import { MainCard } from 'components/MainCard'
import { endpoints } from 'services/endpoints'
import { activeItem } from 'store/reducers/menu'
import { MyRobotType } from 'pages/myrobots/types'

import { FormAction } from './formAction'
import { ActionDetailType } from './types'

const DetailAction = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const [searchParams] = useSearchParams()
  const returnGraphic = searchParams.get('returnGraphic')
  const insertMode = id === 'add'
  const { data: dataAction, isLoading: isLoadingAction } = useSWR<
    ActionDetailType,
    Error
  >(!insertMode ? { url: endpoints.home.libraries.action, body: { id } } : null)

  const backFunction = () => {
    if (returnGraphic) {
      void navigate(`/graphic/${returnGraphic}`)
    } else {
      void dispatch(activeItem('actions'))
      void navigate('/actions')
    }
  }

  const { data: dataMyRobots, isLoading: isLoadingMyRobots } = useSWR<
    MyRobotType[],
    Error
  >({
    url: endpoints.home.libraries.myRobots,
  })

  const isLoading = isLoadingAction || isLoadingMyRobots
  const data = dataAction && dataMyRobots

  const subtitle = insertMode
    ? 'Here you can define the details of the Skill. Hover over fields to see their descriptions.'
    : 'Here you can edit the details of the Skill. Hover over fields to see their descriptions.'

  return (
    <MainCard
      title={insertMode ? 'Add Skill' : 'Skill Detail'}
      subtitle={subtitle}
      backFunction={backFunction}
      backTitle={
        returnGraphic ? 'Return to the task graphic' : 'Return to Skills'
      }
    >
      {isLoading && !insertMode && <CircularProgress />}
      {data === null && <Typography>Skill with ID {id} not found</Typography>}
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
