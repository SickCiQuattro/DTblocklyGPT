import React from 'react'
import { Box, Typography, Button } from '@mui/material'
import { useDispatch } from 'react-redux'
import { Code } from 'lucide-react'

import { useAppSelector } from 'store/reducers'
import { toggleCode } from 'store/reducers/task'

export const StatusBar: React.FC = () => {
  const dispatch = useDispatch()
  const lastSaved = useAppSelector((state) => state.task.lastSaved)
  const codeOpen = useAppSelector((state) => state.task.codeOpen)

  return (
    <Box
      sx={{
        height: '40px',
        minHeight: '40px',
        bgcolor: '#F0F0F2',
        borderTop: '1px solid rgba(0, 0, 0, 0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        fontFamily: "'Geist Mono', monospace",
        color: '#6B7280',
        zIndex: 10,
        boxSizing: 'border-box',
      }}
    >
      {/* Left side: Robot status */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#22C55E',
            display: 'inline-block',
            boxShadow: '0 0 8px #22C55E',
          }}
        />
        <Typography
          sx={{
            fontFamily: 'inherit',
            fontSize: '0.74rem',
            fontWeight: 500,
          }}
        >
          Robot: Online
        </Typography>
      </Box>

      {/* Center: Last saved timestamp */}
      <Box>
        <Typography
          sx={{
            fontFamily: 'inherit',
            fontSize: '0.74rem',
            fontWeight: 500,
          }}
        >
          {lastSaved ? `Saved at ${lastSaved}` : 'Draft not saved'}
        </Typography>
      </Box>

      {/* Right side: View Code toggle */}
      <Box>
        <Button
          onClick={() => dispatch(toggleCode())}
          size="small"
          startIcon={<Code size={14} />}
          sx={{
            fontFamily: "'Geist Mono', monospace",
            fontSize: '0.74rem',
            textTransform: 'none',
            fontWeight: 500,
            color: codeOpen ? 'primary.main' : 'inherit',
            minWidth: 0,
            padding: '2px 8px',
            '&:hover': {
              bgcolor: 'rgba(99, 102, 241, 0.04)',
            },
          }}
        >
          {codeOpen ? 'Hide Code' : 'View Code'}
        </Button>
      </Box>
    </Box>
  )
}
