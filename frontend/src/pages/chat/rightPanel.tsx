import React from 'react'
import { Accordion, AccordionSummary, AccordionDetails, Divider, Box, Typography, IconButton, useTheme } from '@mui/material'
import { Copy, HelpCircle, ChevronDown } from 'lucide-react'
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
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '1rem', fontSize: '1.25rem', color: theme.palette.text.primary }}>
        <HelpCircle size={20} /> Instructions & FAQ
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
          <b>Processing</b> (optional): use an already defined <b>routine</b>.
        </li>
      </ol>
      <p>
        It is possible to specify the number of times to repeat the
        pick-and-place (and processing) or to run it only if a certain
        object is found or a signal is received from a sensor or from the human.
      </p>
      <p>Other useful information:</p>
      <ul>
        <li>Ask if you don&apos;t know how to proceed</li>
        <li>Task will not be saved until the end of the conversation</li>
      </ul>
      <Divider sx={{ my: 2 }} />
      <Accordion defaultExpanded sx={{ mt: '1rem', mr: '1rem' }}>
        <AccordionSummary expandIcon={<ChevronDown size={16} />}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', pr: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              Task JSON
            </Typography>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation()
                void navigator.clipboard
                  .writeText(
                    taskStructure
                      ? JSON.stringify(taskStructure, null, 2)
                      : '',
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
          {taskStructure ? (
            <pre style={{ margin: 0, overflowX: 'auto', fontSize: '12px' }}>
              {JSON.stringify(taskStructure, null, 2)}
            </pre>
          ) : (
            <i>None</i>
          )}
        </AccordionDetails>
      </Accordion>
    </div>
  )
}
