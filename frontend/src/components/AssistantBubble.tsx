import React from 'react'
import { Avatar } from '@mui/material'
import { useTheme, alpha } from '@mui/material/styles'
import { Bot, Lightbulb, AlertTriangle } from 'lucide-react'
import dayjs from 'dayjs'

import { formatTimeFrontend } from 'utils/date'
import { MessagePart } from 'utils/chat'

interface AssistantBubbleProps {
  text: string
  /** BCP-47 language of `text`, declared on the element that carries it. The
   * document is `lang="en"` and the interface is English; only this bubble can
   * be in another language, and only it needs to say so. */
  lang?: string
  timestamp: string | null
  avatarUrl?: string
  parts?: MessagePart[]
  /** Required, not optional. A suggestion chip is drawn in the same indigo,
   * the same border and the same radius as the Review and Apply buttons, and
   * its content is phrased as an action ("Set confirmation to thumbs up
   * gesture"). It was a plain div with no handler and no pointer cursor, so
   * the one element in the panel that looked pressable was the one element
   * that did nothing. Making the prop required means the affordance can only
   * be drawn where it is real. */
  onSuggestionClick: (text: string) => void
  /** A send is already in flight — the chip would be swallowed by the guard
   * in sendText, which is the same silence this whole change removes. */
  suggestionsDisabled?: boolean
}

export const AssistantBubble: React.FC<AssistantBubbleProps> = ({
  text,
  lang,
  timestamp,
  parts,
  onSuggestionClick,
  suggestionsDisabled,
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
        .suggestion-chip {
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .suggestion-chip:not(:disabled):hover {
          background: ${alpha(theme.palette.primary.main, 0.14)} !important;
          border-color: ${alpha(theme.palette.primary.main, 0.34)} !important;
        }
        .suggestion-chip:not(:disabled):active {
          transform: scale(0.99);
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
              // No opacity dimming here (unlike UserBubble's timestamp,
              // which has headroom): success.darker on this bubble's tinted
              // background only clears WCAG AA (4.5:1) at full opacity —
              // 0.8 dropped it to 3.6:1.
              color: theme.palette.success.darker,
            }}
          >
            {time}
          </span>
        </div>
        <div
          lang={lang}
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
                <button
                  key={`s-${idx}`}
                  type="button"
                  onClick={() => onSuggestionClick(part.content)}
                  disabled={suggestionsDisabled}
                  className="suggestion-chip"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '13px',
                    textAlign: 'left',
                    font: 'inherit',
                    color: theme.palette.primary.darker,
                    background: alpha(theme.palette.primary.main, 0.08),
                    border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                    borderRadius: '10px',
                    padding: '6px 10px',
                    cursor: suggestionsDisabled ? 'default' : 'pointer',
                    opacity: suggestionsDisabled ? 0.55 : 1,
                  }}
                >
                  <Lightbulb size={14} style={{ flexShrink: 0 }} />
                  <span>{part.content}</span>
                </button>
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
