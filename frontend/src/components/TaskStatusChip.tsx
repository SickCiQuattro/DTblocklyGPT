import React from 'react'
import { Chip } from '@mui/material'

import { taskStatusVisual } from 'utils/taskStatus'

interface TaskStatusChipProps {
  status?: string
}

// Shared status pill so a task's status looks the same everywhere it appears.
export const TaskStatusChip: React.FC<TaskStatusChipProps> = ({ status }) => {
  const cfg = taskStatusVisual(status)
  return (
    <Chip
      size="small"
      label={cfg.label}
      sx={{
        bgcolor: cfg.bg,
        color: cfg.color,
        borderColor: cfg.border,
        borderWidth: 1,
        borderStyle: 'solid',
        fontSize: '0.72rem',
        fontWeight: 600,
        height: '22px',
        borderRadius: '4px',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    />
  )
}
