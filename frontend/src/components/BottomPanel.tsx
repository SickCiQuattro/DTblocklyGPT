import React, { useState } from 'react'
import { Box, Typography, IconButton, Tooltip } from '@mui/material'
import { Maximize2, Minimize2 } from 'lucide-react'

import { Theme as ThemeOption } from 'themes/theme'

import { panel as panelTokens } from './digitalTwin/panelTokens'

// Intentionally-dark developer terminal (design spec §3.8) — same spec
// section, and the same dark surface, as the robot panel (panelTokens.ts
// cites §3.6/§3.8 too). Reuse its bg token instead of a second near-black
// literal that drifted from it (#141423 vs #0c0c1c).
const tokens = ThemeOption()
const PANEL_BG = panelTokens.bg
const PANEL_TEXT = '#A9B2C3'
// primary.main is only 4.33:1 on PANEL_BG (fails AA) — primary.400
// (panelTokens.primaryLight, same value used for the same reason on the
// robot panel) clears 6.49:1.
const PANEL_ACCENT = panelTokens.primaryLight
const TERMINAL_GREEN = tokens.success.light
const TERMINAL_NUMBER = tokens.info.light
const TERMINAL_KEYWORD = tokens.warning.light

// Design spec §3.8 calls for "syntax highlight" on the JSON view — this is
// the classic escape-then-tag-tokens approach (MDN's canonical json-format
// snippet): HTML-escape the whole string FIRST, then a single regex finds
// string/number/boolean/null tokens in the already-escaped text and wraps
// each in a <span>. Because escaping happens before any tag is introduced,
// no user-authored field (e.g. a step description containing "<") can break
// out of its span — dangerouslySetInnerHTML below is safe on that ordering.
const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const highlightJson = (data: unknown): string => {
  const escaped = escapeHtml(JSON.stringify(data, null, 2))
  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let color = TERMINAL_NUMBER
      if (/^"/.test(match)) {
        color = /:$/.test(match) ? PANEL_ACCENT : TERMINAL_GREEN
      } else if (/^(true|false|null)$/.test(match)) {
        color = TERMINAL_KEYWORD
      }
      return `<span style="color:${color}">${match}</span>`
    },
  )
}

interface BottomPanelProps {
  data: any[]
  open: boolean
}

export const BottomPanel: React.FC<BottomPanelProps> = ({ data, open }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <Box
      // Collapsed to height:0 rather than unmounted (keeps state across
      // toggles) — inert keeps its contents out of the tab order and the
      // accessibility tree while collapsed, not just visually clipped.
      inert={!open}
      sx={{
        height: open ? (isExpanded ? '55vh' : '24vh') : 0,
        minHeight: open ? (isExpanded ? '55vh' : '24vh') : 0,
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden',
        background: PANEL_BG,
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        color: PANEL_TEXT,
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
            color: PANEL_ACCENT,
          }}
        >
          Task Code
        </Typography>
        <Tooltip title={isExpanded ? 'Minimize panel' : 'Maximize panel'}>
          <IconButton
            size="small"
            onClick={() => setIsExpanded(!isExpanded)}
            sx={{
              color: PANEL_TEXT,
              padding: '2px',
              '&:hover': {
                color: '#FFF',
                background: 'rgba(255, 255, 255, 0.08)',
              },
            }}
          >
            {isExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </IconButton>
        </Tooltip>
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
            color: PANEL_TEXT,
          }}
          // Safe: highlightJson HTML-escapes the full string before wrapping
          // any token in a <span> — see the comment above its definition.
          dangerouslySetInnerHTML={{ __html: highlightJson(data) }}
        />
      </Box>
    </Box>
  )
}
