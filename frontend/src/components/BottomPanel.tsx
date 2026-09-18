import React, { useEffect } from 'react'
import { Box, Typography, IconButton, Tooltip } from '@mui/material'
import { X } from 'lucide-react'
import { useDispatch } from 'react-redux'

import { Theme as ThemeOption } from 'themes/theme'
import { useAppSelector } from 'store/reducers'
import {
  CODE_PANEL_MIN_PX,
  CODE_PANEL_RAIL_PX,
  setCodePanelHeight,
  toggleCode,
} from 'store/reducers/task'

import { panel as panelTokens } from './digitalTwin/panelTokens'

// Intentionally-dark developer terminal (design spec §3.8) — the same dark
// surface as the robot panel (panelTokens.ts cites §3.6/§3.8 too).
//
// `surface`, not `bg`. Both tokens exist and they are not the same colour on
// screen: `bg` is the flat swatch #0c0c1c, while `surface` is that colour at
// 0.97 over the app's #F5F5F7 page, which composites to #131323. The robot
// panel paints `surface`; this one painted `bg`, so the two dark surfaces sat
// 1.06:1 apart — the same thing declared twice with two answers. It also made
// every contrast figure computed here optimistic, which is precisely the trap
// panelTokens.muted's own comment documents.
const tokens = ThemeOption()
const PANEL_BG = panelTokens.surface
// Was a hardcoded #A9B2C3 while panelTokens.textDim (#94A3B8) existed for
// exactly this role. It paints the JSON's punctuation — braces, commas — which
// is structural noise beside the highlighted tokens, so the dim step is right.
const PANEL_TEXT = panelTokens.textDim
// primary.main is only 4.33:1 on this surface (fails AA) — primary.400
// (panelTokens.primaryLight, same value used for the same reason on the
// robot panel) clears 6.49:1.
const PANEL_ACCENT = panelTokens.primaryLight
const TERMINAL_GREEN = tokens.success.light
const TERMINAL_NUMBER = tokens.info.light
const TERMINAL_KEYWORD = tokens.warning.light

// The workspace's floor, in px: what the panel may never grow past taking.
// Below this the canvas is a letterbox of half-drawn blocks — the same
// argument, and the same remedy, as the robot panel's width clamp.
const WORKSPACE_FLOOR_PX = 220

/**
 * The panel's outer height as a CSS length, clamped.
 *
 * Published as `--layout-codepanel-height` on the document element, and read
 * back by two boxes that must agree with it: this panel's own `height`, and
 * the robot panel's `bottom` — that one is `position: fixed`, so nothing links
 * it to this panel and it would otherwise sit on top of it.
 *
 * The clamp lives inside the published value rather than in a `max-height`
 * here, so the variable stays truthful: a `max-height` would cap the rendered
 * panel while the robot panel kept lifting itself by the uncapped number, and
 * the gap between them would open on short viewports.
 */
const clampedHeightCss = (px: number) =>
  `min(${px}px, calc(100vh - var(--layout-appbar-height, 56px) - var(--layout-statusbar-height, 40px) - ${WORKSPACE_FLOOR_PX}px))`

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
  const dispatch = useDispatch()
  const codePanelHeight = useAppSelector((state) => state.task.codePanelHeight)
  const [isResizing, setIsResizing] = React.useState(false)

  // One channel, written once per frame, read by everything that depends on
  // it — the same mechanism Copilot and the robot panel already use for their
  // widths. Skipped while a drag is in flight: the pointer handler owns the
  // property then, and re-running this effect would fight it.
  useEffect(() => {
    if (isResizing) return
    document.documentElement.style.setProperty(
      '--layout-codepanel-height',
      open ? clampedHeightCss(codePanelHeight) : `${CODE_PANEL_RAIL_PX}px`,
    )
  }, [codePanelHeight, open, isResizing])

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = codePanelHeight
    let latest = startHeight
    setIsResizing(true)
    // Read by stylesheets, not by components, and it has to land in the same
    // frame as the height — so a DOM attribute, not Redux. It suspends the
    // height tween below and the robot panel's own transitions.
    document.documentElement.dataset.panelResizing = ''
    const onMove = (ev: PointerEvent) => {
      // Dragging UP grows: the panel is anchored to the bottom edge.
      latest = Math.max(CODE_PANEL_MIN_PX, startHeight + (startY - ev.clientY))
      document.documentElement.style.setProperty(
        '--layout-codepanel-height',
        clampedHeightCss(latest),
      )
    }
    // pointercancel, not just pointerup: under touch the system can take the
    // pointer away mid-gesture and pointerup never fires, which would leave
    // both listeners attached and data-panel-resizing stuck on the document.
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      setIsResizing(false)
      delete document.documentElement.dataset.panelResizing
      dispatch(setCodePanelHeight(latest))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  return (
    <Box
      sx={{
        height: `var(--layout-codepanel-height, ${CODE_PANEL_RAIL_PX}px)`,
        flexShrink: 0,
        position: 'relative',
        boxSizing: 'border-box',
        // Horizontal inset only, and the top corners only. This is a drawer
        // rising off the status bar, not a floating card: rounding the bottom
        // and insetting it from a bar it is flush against would leave it
        // hovering over a 12px sliver of page.
        marginInline: 'var(--layout-gutter)',
        borderRadius: '16px 16px 0 0',
        border: `1px solid ${panelTokens.hairlineStrong}`,
        borderBottom: 'none',
        // Opens and closes with a tween; follows the pointer without one. The
        // same rule as the robot panel's width, for the same reason: a 300ms
        // ease restarted on every pointermove chases the cursor a third of a
        // second behind.
        transition: 'height 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        'html[data-panel-resizing] &': { transition: 'none' },
        overflow: 'hidden',
        background: PANEL_BG,
        color: PANEL_TEXT,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Resize handle on the top edge, because the panel is anchored to the
          bottom. Same WAI-ARIA "Window Splitter" pattern as Copilot and the
          robot panel — role separator, focusable, arrow keys. This one used to
          be a Maximize/Minimize icon snapping between 24vh and 55vh, which is
          the two-state model those two panels were just moved off. */}
      {open && (
        /* eslint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */
        <div
          onPointerDown={startResize}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize task code panel"
          aria-valuenow={codePanelHeight}
          aria-valuemin={CODE_PANEL_MIN_PX}
          tabIndex={0}
          onKeyDown={(e) => {
            const STEP = 16
            // Up grows: the panel grows towards the workspace.
            const delta =
              e.key === 'ArrowUp' ? STEP : e.key === 'ArrowDown' ? -STEP : null
            if (delta === null) return
            e.preventDefault()
            dispatch(setCodePanelHeight(codePanelHeight + delta))
          }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '6px',
            cursor: 'row-resize',
            // Without this the browser claims the gesture for page scrolling
            // and the drag never reaches the handler on a touch screen.
            touchAction: 'none',
            zIndex: 1,
            background: 'transparent',
          }}
        />
        /* eslint-enable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */
      )}

      {/* Collapsed to the rail rather than unmounted (keeps scroll position
          and syntax state across toggles) — `inert` keeps the contents out of
          the tab order and the accessibility tree while collapsed, not just
          visually clipped. It sits on this wrapper and not on the card,
          because the rail below has to stay clickable while the panel is
          closed, and an inert ancestor would kill it too. */}
      <Box
        inert={!open}
        sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 20px',
            background: panelTokens.chrome,
            borderBottom: `1px solid ${panelTokens.hairline}`,
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
          {/* Closing lived only in the status bar's "Hide Code", at the
              opposite corner from the panel it closes — a third way of
              dismissing a panel in an app where the other two carry an ✕ in
              their own header. */}
          <Tooltip title="Hide code">
            <IconButton
              size="small"
              onClick={() => dispatch(toggleCode())}
              aria-label="Hide code"
              sx={{
                color: PANEL_TEXT,
                padding: '2px',
                '&:hover': {
                  color: panelTokens.white,
                  background: panelTokens.hover,
                },
              }}
            >
              <X size={15} />
            </IconButton>
          </Tooltip>
        </Box>

        <Box
          sx={{
            flex: 1,
            padding: '16px 20px',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            margin: 0,
            '&::-webkit-scrollbar': {
              width: '6px',
              height: '6px',
            },
            '&::-webkit-scrollbar-track': {
              background: 'transparent',
            },
            '&::-webkit-scrollbar-thumb': {
              background: panelTokens.trackBg,
              borderRadius: '4px',
            },
            '&::-webkit-scrollbar-thumb:hover': {
              background: panelTokens.selectBorder,
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

      {/* The closed rail, and the only part of this panel that is live while
          it is closed — so it sits outside the `inert` box above.

          It is the dark line along the bottom edge, kept because it reads as a
          closed drawer and is the one hint that the code view exists at all.
          It used to be an accident: a semi-transparent border-top on a
          zero-height box, letting the panel's own background through. Now it
          is the panel's own rail, and it does what it looks like it does. */}
      {!open && (
        <Box
          component="button"
          type="button"
          onClick={() => dispatch(toggleCode())}
          aria-label="Show task code"
          aria-expanded={false}
          sx={{
            position: 'absolute',
            inset: 0,
            border: 'none',
            padding: 0,
            background: 'transparent',
            cursor: 'pointer',
            display: 'block',
          }}
        />
      )}
    </Box>
  )
}
