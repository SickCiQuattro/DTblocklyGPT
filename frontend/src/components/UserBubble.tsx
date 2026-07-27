import React from 'react'
import { Avatar } from '@mui/material'
import { useTheme, alpha } from '@mui/material/styles'
import { User } from 'lucide-react'
import dayjs from 'dayjs'

import { formatTimeFrontend } from 'utils/date'

interface UserBubbleProps {
  text: string
  timestamp: string | null
  user: string // username
  avatarUrl?: string
}

export const UserBubble: React.FC<UserBubbleProps> = ({
  text,
  timestamp,
  user,
}) => {
  const theme = useTheme()
  const accent = theme.palette.primary.dark
  const time = timestamp
    ? formatTimeFrontend(timestamp)
    : dayjs().format('HH:mm')

  return (
    <div
      className="user-bubble-premium"
      style={{
        margin: '8px 0',
        maxWidth: '85%',
        alignSelf: 'flex-end',
        background: alpha(accent, 0.07),
        border: `1px solid ${alpha(accent, 0.14)}`,
        borderRadius: '16px 16px 4px 16px',
        padding: '12px 16px',
        boxShadow: `0 2px 8px ${alpha(accent, 0.03)}`,
      }}
    >
      <style>{`
        .user-bubble-premium {
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .user-bubble-premium:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px ${alpha(accent, 0.08)} !important;
          background: ${alpha(accent, 0.11)} !important;
          border-color: ${alpha(accent, 0.22)} !important;
        }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Avatar
              sx={{
                width: 24,
                height: 24,
                background: alpha(accent, 0.15),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <User size={16} style={{ color: accent }} />
            </Avatar>
            <span
              style={{
                fontWeight: 600,
                fontSize: '13px',
                color: theme.palette.primary.darker,
              }}
            >
              {user}
            </span>
          </div>
          <span
            style={{
              fontSize: '11px',
              color: theme.palette.primary.darker,
              opacity: 0.8,
            }}
          >
            {time}
          </span>
        </div>
        <div
          style={{
            fontSize: '14px',
            color: theme.palette.primary.darker,
            lineHeight: '1.5',
            wordBreak: 'break-word',
            maxInlineSize: '65ch',
          }}
        >
          {text}
        </div>
      </div>
    </div>
  )
}
