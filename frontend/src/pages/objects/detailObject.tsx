import React from 'react'
import { CircularProgress, Typography } from '@mui/material'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import useSWR from 'swr'
import { useDispatch } from 'react-redux'

import { MainCard } from 'components/MainCard'
import { endpoints } from 'services/endpoints'
import { activeItem } from 'store/reducers/menu'
import { MyRobotType } from 'pages/myrobots/types'
import { FormObject } from './formObject'
import { ObjectDetailType } from './types'

const DetailObject = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const insertMode = id === 'add'
  const [searchParams] = useSearchParams()
  const returnGraphic = searchParams.get('returnGraphic')
  const { data: dataObject, isLoading: isLoadingObject } = useSWR<
    ObjectDetailType,
    Error
  >(!insertMode ? { url: endpoints.home.libraries.object, body: { id } } : null)

  const backFunction = () => {
    if (returnGraphic) {
      navigate(`/graphic/${returnGraphic}`)
    } else {
      dispatch(activeItem('objects'))
      navigate('/objects')
    }
  }

  const { data: dataMyRobots, isLoading: isLoadingMyRobots } = useSWR<
    MyRobotType[],
    Error
  >({
    url: endpoints.home.libraries.myRobots,
  })

  const isLoading = isLoadingObject || isLoadingMyRobots
  const data = dataObject && dataMyRobots

  const subtitle = insertMode
    ? 'Here you can define the detail of the Objects. Stay hover the fields to see the description.'
    : 'Here you can edit the detail of the Object. Stay hover the fields to see the description.'

  return (
    <MainCard
      title={insertMode ? 'Add object' : 'Object detail'}
      subtitle={subtitle}
      backFunction={backFunction}
      backTitle={
        returnGraphic
          ? 'Return to the task graphic'
          : 'Return to the list of objects'
      }
    >
      {isLoading && !insertMode && <CircularProgress />}
      {data === null && <Typography>Object with ID {id} not found</Typography>}
      {(data || insertMode) && (
        <FormObject
          dataObject={dataObject}
          dataMyRobots={dataMyRobots}
          insertMode={insertMode}
          backFunction={backFunction}
        />
      )}
    </MainCard>
  )
}

export default DetailObject
