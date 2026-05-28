import { Accordion, AccordionSummary, AccordionDetails, Divider, Box, Typography, IconButton, useTheme } from '@mui/material'
import { toast } from 'react-toastify'
import { Copy, HelpCircle, ChevronDown } from 'lucide-react'

import { MessageText } from 'utils/messages'
import { AbstractStep } from 'pages/tasks/types'

interface RightPanelProps {
  dataTask: AbstractStep[] | null
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
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.25rem', color: theme.palette.text.primary }}>
        <HelpCircle size={20} /> Instructions & FAQ
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
      <Divider sx={{ my: 2 }} />
      <Accordion defaultExpanded sx={{ mt: '1rem', mr: '1rem' }}>
        <AccordionSummary expandIcon={<ChevronDown size={16} />}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', pr: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              Task representation
            </Typography>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation()
                void navigator.clipboard
                  .writeText(
                    dataTask ? JSON.stringify(dataTask, null, 2) : '',
                  )
                  .then(() => toast.success(MessageText.copiedInClipboard))
                  .catch(() => undefined)
              }}
            >
              <Copy size={16} />
            </IconButton>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {dataTask ? (
            <pre style={{ margin: 0, overflowX: 'auto', fontSize: '12px' }}>
              {JSON.stringify(dataTask, null, 2)}
            </pre>
          ) : (
            <i>None</i>
          )}
        </AccordionDetails>
      </Accordion>
    </div>
  )
}
