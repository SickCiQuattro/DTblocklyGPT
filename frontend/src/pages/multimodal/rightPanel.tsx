import { Collapse, Divider } from 'antd'
import { useTheme } from '@mui/material'
import { toast } from 'react-toastify'
import { MessageText } from 'utils/messages'
import { CopyOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { AbstractStep } from 'pages/tasks/types'

interface RightPanelProps {
  dataTask: AbstractStep[]
}

export const RightPanel = ({ dataTask }: RightPanelProps) => {
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
      <h2>
        <QuestionCircleOutlined /> Instructions & FAQ
      </h2>
      <p>In this multimodal interface you can interact with your task.</p>
      <ul>
        <li>
          First of all, enable the <i>Editing mode</i> in the top left corner to
          start to interact
        </li>
        <li>
          You can drag the blocks from the panel that appears by clicking on
          each category on the right. Then drag these into the workspace.
        </li>
        <li>
          You can interact with your task also through the chat interface
          expressing your requests in natural language.
        </li>
        <li>
          All changes will be lost if you exit without clicking the <i>Save</i>{' '}
          button.
        </li>
      </ul>
      <Divider />
      <Collapse
        key="task-collapse-debug"
        style={{ marginTop: '1rem', marginRight: '1rem' }}
        items={[
          {
            label: 'Task JSON',
            key: 'task-json',
            children: dataTask ? (
              <pre>{JSON.stringify(dataTask, null, 2)}</pre>
            ) : (
              <i>None</i>
            ),
            extra: (
              <>
                <CopyOutlined
                  style={{ marginRight: '1rem' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    navigator.clipboard
                      .writeText(
                        dataTask ? JSON.stringify(dataTask, null, 2) : '',
                      )
                      .then(() => toast.success(MessageText.copiedInClipboard))
                  }}
                />
              </>
            ),
          },
        ]}
      />
    </div>
  )
}
