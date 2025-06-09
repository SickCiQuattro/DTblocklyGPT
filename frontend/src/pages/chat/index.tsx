import { CircularProgress, Typography } from '@mui/material'
import { SoundOutlined } from '@ant-design/icons'
import React from 'react'
import { useParams } from 'react-router-dom'
import useSWR from 'swr'

import { endpoints } from 'services/endpoints'
import { MainCard } from 'components/MainCard'
import { TaskDetailType } from 'pages/tasks/types'
import { Palette } from 'themes/palette'
import { SplittedLayout } from './splittedLayout'
import { INITIAL_TASK_STRUCTURE, TaskChatStructure } from './utils'

const Chat = () => {
  const { id } = useParams()
  const [speaker, setSpeaker] = React.useState(false)
  const themePalette = Palette('light')
  const [taskStructure, setTaskStructure] = React.useState<TaskChatStructure>(
    INITIAL_TASK_STRUCTURE,
  )

  const { data, isLoading } = useSWR<TaskDetailType, Error>({
    url: endpoints.home.libraries.task,
    body: { id },
  })

  const title = data ? `Chat to create the task: "${data.name}"` : ''

  return (
    <MainCard
      title={title}
      customElement={
        <SoundOutlined
          onClick={() => setSpeaker(!speaker)}
          style={{
            color: speaker
              ? themePalette.palette.primary.main
              : themePalette.palette.error.main,
            fontSize: '2em',
          }}
        />
      }
    >
      {isLoading && <CircularProgress />}
      {data === null && <Typography>Task with ID {id} not found</Typography>}
      {data && (
        <SplittedLayout
          speaker={speaker}
          taskStructure={taskStructure}
          setTaskStructure={setTaskStructure}
        />
      )}
    </MainCard>
  )
}

export default Chat
