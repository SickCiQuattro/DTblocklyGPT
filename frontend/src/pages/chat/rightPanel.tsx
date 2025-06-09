import React from 'react'
import { Collapse } from 'antd'
import { Divider, useTheme } from '@mui/material'

// import { MainCard } from 'components/MainCard'
// import { backgroundForm } from 'themes/theme'
import { CopyOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { toast } from 'react-toastify'
import { MessageText } from 'utils/messages'
import { TaskChatStructure } from './utils'

interface RightPanelProps {
  taskStructure: TaskChatStructure
}

export const RightPanel = ({ taskStructure }: RightPanelProps) => {
  const theme = useTheme()

  return (
    <div
      style={{
        borderLeft: `1px solid ${theme.palette.grey[300]}`,
        paddingLeft: '1rem',
        width: '33.33%',
        overflow: 'auto',
      }}
    >
      {/*       <MainCard
        sx={{
          background: backgroundForm,
          marginRight: '1rem',
        }}
      >
        TASK IN PROGRESS
      </MainCard> */}
      <h2 style={{ marginTop: '1rem' }}>
        <QuestionCircleOutlined /> Instructions & FAQ
      </h2>
      <p>In this chat you can define a new task.</p>
      <p>The steps to be defined are:</p>
      <ol>
        <li>
          <b>Pick</b>: use an already defined <b>object</b>.
        </li>
        <li>
          <b>Place</b>: use an already defined <b>location</b>.
        </li>
        <li>
          <b>Processing</b> (optional): use an already defined <b>action</b>.
        </li>
      </ol>
      <p>
        It is possible to specify the number of times to repeat the
        pick-and-place (and processing) or to perform it only if a certain
        object is found or a signal is received from a sensor or from the human.
      </p>
      <p>Other useful information:</p>
      <ul>
        <li>Ask if you don&apos;t know how to proceed</li>
        <li>Task will not be saved until the end of the conversation</li>
      </ul>
      <Divider />
      <Divider style={{ marginTop: '1rem' }} />
      <Collapse
        key="task-collapse-debug"
        style={{ marginTop: '1rem', marginRight: '1rem' }}
        items={[
          {
            label: 'Task JSON',
            key: 'task-json',
            children: taskStructure ? (
              <pre>{JSON.stringify(taskStructure, null, 2)}</pre>
            ) : (
              <i>None</i>
            ),
            extra: (
              <CopyOutlined
                style={{
                  marginRight: '1rem',
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  navigator.clipboard
                    .writeText(
                      taskStructure
                        ? JSON.stringify(taskStructure, null, 2)
                        : '',
                    )
                    .then(() => toast.success(MessageText.copiedInClipboard))
                }}
              />
            ),
          },
        ]}
      />
    </div>
  )
}
