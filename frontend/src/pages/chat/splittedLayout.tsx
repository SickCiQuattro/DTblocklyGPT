import React from 'react'
import { useMediaQuery } from '@mui/material'
import { ChatWrapper } from './chatWrapper'
import { TaskChatStructure } from './utils'
import { RightPanel } from './rightPanel'

interface SplittedLayoutProps {
  speaker: boolean
  taskStructure: TaskChatStructure
  setTaskStructure: (taskStructure: TaskChatStructure) => void
}

export const SplittedLayout = ({
  speaker,
  taskStructure,
  setTaskStructure,
}: SplittedLayoutProps) => {
  const isBigScreen = useMediaQuery('(min-width: 1700px)')
  const height = isBigScreen ? '75vh' : '66vh'
  return (
    <div style={{ display: 'flex', height }}>
      <ChatWrapper
        speaker={speaker}
        taskStructure={taskStructure}
        setTaskStructure={setTaskStructure}
      />
      <RightPanel taskStructure={taskStructure} />
    </div>
  )
}
