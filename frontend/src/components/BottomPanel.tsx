import React, { useState } from 'react'
import { Box, Typography, IconButton } from '@mui/material'
import { Maximize2, Minimize2 } from 'lucide-react'

interface BottomPanelProps {
  data: any[]
  open: boolean
}

export const BottomPanel: React.FC<BottomPanelProps> = ({ data, open }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <Box
      sx={{
        height: open ? (isExpanded ? '55vh' : '24vh') : 0,
        minHeight: open ? (isExpanded ? '55vh' : '24vh') : 0,
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden',
        background: '#141423',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        color: '#A9B2C3',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 20px',
          background: 'rgba(255, 255, 255, 0.02)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
        }}
      >
        <Typography
          sx={{
            fontFamily: "'Geist Mono', monospace",
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: '#6366F1',
          }}
        >
          Task Logic (JSON)
        </Typography>
        <IconButton
          size="small"
          onClick={() => setIsExpanded(!isExpanded)}
          sx={{
            color: '#A9B2C3',
            padding: '2px',
            '&:hover': {
              color: '#FFF',
              background: 'rgba(255, 255, 255, 0.08)',
            },
          }}
          title={isExpanded ? 'Minimize panel' : 'Maximize panel'}
        >
          {isExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </IconButton>
      </Box>

      <Box
        sx={{
          flex: 1,
          padding: '16px 20px',
          overflowY: 'auto',
          margin: 0,
          '&::-webkit-scrollbar': {
            width: '6px',
            height: '6px',
          },
          '&::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(255, 255, 255, 0.1)',
            borderRadius: '4px',
          },
          '&::-webkit-scrollbar-thumb:hover': {
            background: 'rgba(255, 255, 255, 0.2)',
          },
        }}
      >
        <pre
          style={{
            margin: 0,
            fontFamily: "'Geist Mono', 'SFMono-Regular', Consolas, monospace",
            fontSize: '0.8rem',
            lineHeight: 1.5,
            color: '#34D399', // sleek green terminal color
          }}
        >
          {JSON.stringify(data, null, 2)}
        </pre>
      </Box>
    </Box>
  )
}

