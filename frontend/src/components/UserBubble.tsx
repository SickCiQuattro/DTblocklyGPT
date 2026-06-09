import React from 'react'
import { Avatar } from '@mui/material'
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
        background: 'rgba(79, 70, 229, 0.07)',
        border: '1px solid rgba(79, 70, 229, 0.14)',
        borderRadius: '16px 16px 4px 16px',
        padding: '12px 16px',
        boxShadow: '0 2px 8px rgba(79, 70, 229, 0.03)',
      }}
    >
      <style>{`
        .user-bubble-premium {
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .user-bubble-premium:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(79, 70, 229, 0.08) !important;
          background: rgba(79, 70, 229, 0.11) !important;
          border-color: rgba(79, 70, 229, 0.22) !important;
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
                background: 'rgba(79, 70, 229, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <User size={16} style={{ color: '#4f46e5' }} />
            </Avatar>
            <span
              style={{ fontWeight: 600, fontSize: '13px', color: '#1e1b4b' }}
            >
              {user}
            </span>
          </div>
          <span style={{ fontSize: '11px', color: '#6366f1', opacity: 0.8 }}>
            {time}
          </span>
        </div>
        <div
          style={{
            fontSize: '14px',
            color: '#1e1b4b',
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
