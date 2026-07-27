import React from 'react'
import { Avatar } from '@mui/material'
import { useTheme, alpha } from '@mui/material/styles'
import { Bot, Lightbulb, AlertTriangle } from 'lucide-react'
import dayjs from 'dayjs'

import { formatTimeFrontend } from 'utils/date'
import { MessagePart } from 'utils/chat'

interface AssistantBubbleProps {
  text: string
  timestamp: string | null
  avatarUrl?: string
  parts?: MessagePart[]
}

export const AssistantBubble: React.FC<AssistantBubbleProps> = ({
  text,
  timestamp,
  parts,
}) => {
  const theme = useTheme()
  const accent = theme.palette.success.main
  const time = timestamp
    ? formatTimeFrontend(timestamp)
    : dayjs().format('HH:mm')

  return (
    <div
      className="assistant-bubble-premium"
      style={{
        margin: '8px 0',
        maxWidth: '85%',
        alignSelf: 'flex-start',
        background: alpha(accent, 0.06),
        border: `1px solid ${alpha(accent, 0.14)}`,
        borderRadius: '16px 16px 16px 4px',
        padding: '12px 16px',
        boxShadow: `0 2px 8px ${alpha(accent, 0.03)}`,
      }}
    >
      <style>{`
        .assistant-bubble-premium {
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .assistant-bubble-premium:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px ${alpha(accent, 0.08)} !important;
          background: ${alpha(accent, 0.1)} !important;
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
              <Bot size={16} style={{ color: accent }} />
            </Avatar>
            <span
              style={{
                fontWeight: 600,
                fontSize: '13px',
                color: theme.palette.success.darker,
              }}
            >
              Copilot
            </span>
          </div>
          <span
            style={{
              fontSize: '11px',
              color: theme.palette.success.darker,
              opacity: 0.8,
            }}
          >
            {time}
          </span>
        </div>
        <div
          style={{
            fontSize: '14px',
            color: theme.palette.success.darker,
            lineHeight: '1.5',
            wordBreak: 'break-word',
            maxInlineSize: '65ch',
          }}
        >
          {text}
        </div>

        {parts && parts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {parts.map((part, idx) =>
              part.type === 'suggestion' ? (
                <div
                  key={`s-${idx}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '13px',
                    color: theme.palette.primary.darker,
                    background: alpha(theme.palette.primary.main, 0.08),
                    border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                    borderRadius: '10px',
                    padding: '6px 10px',
                  }}
                >
                  <Lightbulb size={14} style={{ flexShrink: 0 }} />
                  <span>{part.content}</span>
                </div>
              ) : part.type === 'warning' ? (
                <div
                  key={`w-${idx}`}
                  role="alert"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '13px',
                    color: theme.palette.warning.darker,
                    background: alpha(theme.palette.warning.main, 0.1),
                    border: `1px solid ${alpha(theme.palette.warning.main, 0.25)}`,
                    borderRadius: '10px',
                    padding: '6px 10px',
                  }}
                >
                  <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                  <span>{part.content}</span>
                </div>
              ) : null,
            )}
          </div>
        )}
      </div>
    </div>
  )
}
