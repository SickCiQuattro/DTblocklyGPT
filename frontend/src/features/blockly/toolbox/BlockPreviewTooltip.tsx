/**
 * BlockPreviewTooltip.tsx
 *
 * Hover tooltip for toolbox block pills that shows:
 *  - A live read-only Blockly block preview (rendered in a singleton workspace)
 *  - Category badge, description text, and input/output metadata
 *  - For macro tasks: a button to open `MacroPreviewModal` with the full routine
 *
 * ### Singleton workspace pattern
 * A single hidden Blockly workspace is shared across all tooltip instances.
 * When a tooltip opens, the workspace host element is moved ("mounted") into
 * the tooltip container DOM node. When it closes, the host is moved back to an
 * off-screen "parking root" so the workspace stays alive between hovers.
 *
 * This avoids the cost of creating and destroying a Blockly workspace on every
 * tooltip open/close event.
 */

import {
  type MouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Tooltip } from '@mui/material'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import {
  Eye,
  ScanEye,
  MapPin,
  Pointer,
  Bot,
  Repeat2,
  Split,
  Clock,
  Zap,
  Mic,
  SquareArrowRightEnter,
  SquareArrowRightExit,
  Box,
  User,
  Workflow,
} from 'lucide-react'

import { BlockState as State } from 'utils/blocklyTypes'

import { type BlockViewMode } from '../utils/useViewSettings'
import { applyBlockViewMode } from '../utils/viewModePresentation'
import { PREVIEW_WORKSPACE_CONFIG } from '../workspace/workspaceConfig'
import { blocksColours } from '../blocks/palette'
import '../styles/editor.css'

import { ToolboxBlockItem } from './toolboxRegistry'
import { MacroPreviewModal } from './MacroPreviewModal'
import './BlockPreviewTooltip.css'

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

/** Width of the tooltip card's block preview area in pixels. */
const PREVIEW_WIDTH = 260
/** Height of the tooltip card's block preview area in pixels. */
const PREVIEW_HEIGHT = 140
/** Delay in ms before the singleton workspace attempts to render the block. */
const PREVIEW_RENDER_DELAY_MS = 24
/** Maximum number of render retries if the container is not ready yet. */
const PREVIEW_RENDER_MAX_ATTEMPTS = 3

// ─── SINGLETON WORKSPACE STATE ────────────────────────────────────────────────
// Module-level variables that survive across React renders. Only one tooltip
// can be "active" at a time; switching tooltips moves the shared host element.

/** Off-screen container that keeps the workspace alive between tooltip opens. */
let singletonParkingRoot: HTMLDivElement | null = null
/** The div element injected into the active tooltip's preview mount point. */
let singletonHost: HTMLDivElement | null = null
/** The shared read-only Blockly workspace used for all block previews. */
let singletonWorkspace: Blockly.WorkspaceSvg | null = null
/** ID of the pending render timeout, used for cancellation. */
let singletonRenderTimeout: number | null = null
/** ID of the pending requestAnimationFrame call, used for cancellation. */
let singletonRenderRaf: number | null = null
/**
 * Monotonically increasing counter that invalidates stale render callbacks.
 * Incremented every time `cancelSingletonRender` is called.
 */
let singletonRenderRequestId = 0
/** Symbol identifying which tooltip instance currently owns the workspace. */
let activeTooltipOwner: symbol | null = null

// ─── CATEGORY BADGE METADATA ──────────────────────────────────────────────────

/**
 * Resolve the category badge label and icon for the tooltip card header.
 * First tries an exact match on the block type, then falls back to hints
 * derived from the category display name.
 *
 * @param itemType            Blockly block type string of the hovered pill.
 * @param fallbackCategoryName Human-readable category name from the toolbox accordion.
 */
// MAPPING REFERENCE:
// - block type ➔ user-facing badge text
// - location_block ➔ Locations (MapPin)
// - action_block ➔ Skills (Zap)
// - macro_task_block ➔ Saved Tasks (Workflow)
const getPreviewCategoryBadgeMeta = (
  itemType: string,
  fallbackCategoryName?: string,
) => {
  switch (itemType) {
    case 'object_block':
      return { label: 'Objects', Icon: Box }
    case 'location_block':
      return { label: 'Locations', Icon: MapPin }
    case 'action_block':
      return { label: 'Skills', Icon: Zap }
    case 'human_action_block':
    case 'notify_action_block':
      return { label: 'Human Actions', Icon: User }
    case 'pick_block':
    case 'processing_block':
    case 'place_block':
    case 'move_to_block':
    case 'gripper_block':
    case 'open_gripper_block':
    case 'close_gripper_block':
    case 'wait_block':
      return { label: 'Robot Actions', Icon: Bot }
    case 'voice_command_block':
      // Voice condition: a microphone, not the detection eye.
      return { label: 'Conditions', Icon: Mic }
    case 'timer_block':
      // Time-based condition: a clock, not the detection eye.
      return { label: 'Conditions', Icon: Clock }
    // find/gesture detection + logic AND/OR/NOT all live in the Conditions
    // category — badge them identically so the preview matches the toolbox.
    case 'find_object_block':
    case 'gesture_block':
    case 'logic_and_block':
    case 'logic_or_block':
    case 'logic_not_block':
      return { label: 'Conditions', Icon: ScanEye }
    case 'macro_task_block':
      return { label: 'Saved Tasks', Icon: Workflow }
    case 'when_block':
    case 'when_otherwise_block':
      // Conditionals branch on a condition — a fork, not a loop.
      return { label: 'Task Flow', Icon: Split }
    case 'repeat_block':
    case 'repeat_until_block':
      return { label: 'Task Flow', Icon: Repeat2 }
    default:
      break
  }

  // Fallback: derive from the category display name
  const hint = (fallbackCategoryName || '').toLowerCase()
  if (hint.includes('block'))
    return { label: fallbackCategoryName ?? 'Task Flow', Icon: Repeat2 }
  if (hint.includes('human') || hint.includes('operator'))
    return { label: fallbackCategoryName ?? 'Human Actions', Icon: User }
  if (hint.includes('robot') || hint.includes('actions'))
    return {
      label: fallbackCategoryName ?? 'Robot Actions',
      Icon: SquareArrowRightEnter,
    }
  if (hint.includes('condition') || hint.includes('events'))
    return { label: fallbackCategoryName ?? 'Conditions', Icon: Eye }
  if (
    hint.includes('workspace') ||
    hint.includes('objects') ||
    hint.includes('library')
  )
    return { label: fallbackCategoryName ?? 'Library', Icon: Box }
  if (hint.includes('tasks') || hint.includes('macro'))
    return { label: fallbackCategoryName ?? 'Saved Tasks', Icon: Pointer }

  return { label: fallbackCategoryName ?? 'Toolbox', Icon: null }
}

// ─── COLOUR HELPERS ───────────────────────────────────────────────────────────

/**
 * Parse a 3- or 6-digit hex colour string into { r, g, b } components.
 * Returns `null` for invalid inputs.
 */
const parseHexColor = (hexColor: string) => {
  const normalized = hexColor.replace('#', '').trim()
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((value) => `${value}${value}`)
          .join('')
      : normalized

  if (!/^[\da-fA-F]{6}$/.test(expanded)) {
    return null
  }

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  }
}

/**
 * Darken an RGB colour by a `factor` in [0, 1].
 * A factor of 0 leaves the colour unchanged; 1 produces black.
 */
const darkenRgb = (
  rgb: { r: number; g: number; b: number },
  factor: number,
) => {
  const clampedFactor = Math.min(Math.max(factor, 0), 1)
  return {
    r: Math.round(rgb.r * (1 - clampedFactor)),
    g: Math.round(rgb.g * (1 - clampedFactor)),
    b: Math.round(rgb.b * (1 - clampedFactor)),
  }
}

// ─── SINGLETON WORKSPACE LIFECYCLE ───────────────────────────────────────────

/**
 * Lazily create and attach the off-screen parking root element to `document.body`.
 * The parking root keeps the workspace host element alive between tooltip opens.
 */
const ensureParkingRoot = () => {
  if (singletonParkingRoot) return singletonParkingRoot

  const root = document.createElement('div')
  root.className = 'block-preview-parking-root'
  root.style.position = 'fixed'
  root.style.left = '-10000px'
  root.style.top = '-10000px'
  root.style.width = PREVIEW_WIDTH + 'px'
  root.style.height = PREVIEW_HEIGHT + 'px'
  root.style.opacity = '0'
  root.style.pointerEvents = 'none'
  root.style.overflow = 'hidden'

  document.body.appendChild(root)
  singletonParkingRoot = root
  return root
}

/** Lazily create the host `<div>` that wraps the singleton Blockly workspace. */
const ensureHost = () => {
  if (singletonHost) return singletonHost

  const host = document.createElement('div')
  host.className = 'block-preview-workspace-host'
  host.style.width = '100%'
  host.style.height = '100%'

  singletonHost = host
  ensureParkingRoot().appendChild(host)
  return host
}

/** Lazily inject the singleton Blockly workspace if it doesn't exist yet. */
const ensureWorkspace = () => {
  if (singletonWorkspace) return singletonWorkspace

  const host = ensureHost()
  singletonWorkspace = Blockly.inject(host, PREVIEW_WORKSPACE_CONFIG)

  return singletonWorkspace
}

/** Move the workspace host back to the parking root (tooltip closed). */
const parkPreviewHost = () => {
  if (!singletonHost || !singletonParkingRoot) return

  if (singletonHost.parentElement !== singletonParkingRoot) {
    singletonParkingRoot.appendChild(singletonHost)
  }
}

/**
 * Move the workspace host into `container` (tooltip opened) and return the
 * workspace, creating it lazily if this is the first ever tooltip open.
 */
const mountPreviewHost = (container: HTMLElement) => {
  const host = ensureHost()
  if (host.parentElement !== container) {
    container.appendChild(host)
  }

  return ensureWorkspace()
}

// ─── BLOCK PREVIEW RENDERING ─────────────────────────────────────────────────

/**
 * Build a minimal Blockly serialisation state from a toolbox item so the
 * singleton workspace can render a preview of the block.
 */
const createPreviewState = (item: ToolboxBlockItem): State => ({
  type: item.type,
  x: 0,
  y: 0,
  fields: item.fields,
  data: item.data,
})

/**
 * Scale and centre the top-most block in the workspace so it fills the
 * preview container without overflowing or being cropped.
 *
 * @param workspace The singleton preview workspace.
 * @param container The DOM element whose dimensions define the preview bounds.
 */
const fitAndCenterTopBlock = (
  workspace: Blockly.WorkspaceSvg,
  container: HTMLElement,
) => {
  const [topBlock] = workspace.getTopBlocks(true)
  if (!topBlock) return

  const blockSize = topBlock.getHeightWidth()
  const containerW = container.clientWidth
  const containerH = container.clientHeight

  if (!blockSize.width || !blockSize.height || !containerW || !containerH)
    return

  const padding = 20
  const scaleX = (containerW - padding * 2) / blockSize.width
  const scaleY = (containerH - padding * 2) / blockSize.height
  const targetScale = Math.min(scaleX, scaleY, 1)

  if (!Number.isFinite(targetScale) || targetScale <= 0) return

  workspace.setScale(targetScale)

  const targetPixelX = (containerW - blockSize.width * targetScale) / 2
  const targetPixelY = (containerH - blockSize.height * targetScale) / 2

  const targetWsX = targetPixelX / targetScale
  const targetWsY = targetPixelY / targetScale

  const current = topBlock.getRelativeToSurfaceXY()
  topBlock.moveBy(targetWsX - current.x, targetWsY - current.y)
  workspace.resizeContents()
}

/**
 * Clear the singleton workspace, append the block, resize the SVG, then
 * use two consecutive `requestAnimationFrame` calls to let Blockly finish
 * its async layout pass before scaling to fit.
 */
const renderPreviewBlock = (
  item: ToolboxBlockItem,
  container: HTMLElement,
  blockViewMode: BlockViewMode,
) => {
  const workspace = mountPreviewHost(container)
  workspace.clear()

  try {
    Blockly.serialization.blocks.append(createPreviewState(item), workspace)
  } catch {
    // Fall back to a bare block state if the full state fails to deserialise.
    Blockly.serialization.blocks.append(
      { type: item.type, x: 0, y: 0 },
      workspace,
    )
  }

  applyBlockViewMode(workspace, blockViewMode)
  Blockly.svgResize(workspace)

  singletonRenderRaf = window.requestAnimationFrame(() => {
    singletonRenderRaf = window.requestAnimationFrame(() => {
      singletonRenderRaf = null
      Blockly.svgResize(workspace)
      fitAndCenterTopBlock(workspace, container)
    })
  })
}

// ─── RENDER SCHEDULER ────────────────────────────────────────────────────────

/**
 * Cancel any pending render timeout or animation frame and increment the
 * request ID so in-flight callbacks self-invalidate.
 */
const cancelSingletonRender = () => {
  singletonRenderRequestId += 1
  if (singletonRenderTimeout !== null) {
    window.clearTimeout(singletonRenderTimeout)
    singletonRenderTimeout = null
  }
  if (singletonRenderRaf !== null) {
    window.cancelAnimationFrame(singletonRenderRaf)
    singletonRenderRaf = null
  }
}

/**
 * Schedule a block preview render, retrying up to `PREVIEW_RENDER_MAX_ATTEMPTS`
 * times if the target container is not yet visible in the DOM.
 *
 * The `owner` symbol and `requestId` snapshot prevent stale callbacks from
 * rendering into the wrong tooltip after rapid mouse movements.
 *
 * @param owner           Symbol of the currently active tooltip instance.
 * @param item            The toolbox block item to preview.
 * @param resolveContainer Getter that returns the current mount point `<div>`.
 */
const scheduleSingletonRender = (
  owner: symbol,
  item: ToolboxBlockItem,
  resolveContainer: () => HTMLDivElement | null,
  blockViewMode: BlockViewMode,
) => {
  cancelSingletonRender()
  const requestId = singletonRenderRequestId

  const tryRender = (attempt: number) => {
    singletonRenderTimeout = window.setTimeout(() => {
      if (requestId !== singletonRenderRequestId) return
      if (activeTooltipOwner !== owner) return

      singletonRenderRaf = window.requestAnimationFrame(() => {
        if (requestId !== singletonRenderRequestId) return
        if (activeTooltipOwner !== owner) return

        const container = resolveContainer()
        const isContainerReady =
          !!container &&
          container.isConnected &&
          container.clientWidth > 0 &&
          container.clientHeight > 0

        if (!isContainerReady) {
          if (attempt < PREVIEW_RENDER_MAX_ATTEMPTS) {
            tryRender(attempt + 1)
          }
          return
        }

        renderPreviewBlock(item, container, blockViewMode)
      })
    }, PREVIEW_RENDER_DELAY_MS)
  }

  tryRender(0)
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

interface BlockPreviewTooltipProps {
  item: ToolboxBlockItem
  categoryName?: string
  categoryColour?: string
  blockViewMode?: BlockViewMode
  children: ReactElement
}

/**
 * Wraps a toolbox pill with a rich hover tooltip that renders a live block
 * preview and shows descriptive metadata. For macro task pills an additional
 * "View Task Blocks" button opens `MacroPreviewModal`.
 */
export const BlockPreviewTooltip = ({
  item,
  categoryName,
  categoryColour,
  blockViewMode = 'complete',
  children,
}: BlockPreviewTooltipProps) => {
  const previewMountRef = useRef<HTMLDivElement | null>(null)
  /** Unique symbol identifying this tooltip instance as the active owner. */
  const ownerRef = useRef(Symbol('block-preview-tooltip-owner'))

  const [isOpen, setIsOpen] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const isMacroPreviewAvailable =
    item.type === 'macro_task_block' &&
    typeof item.macroCode === 'string' &&
    item.macroCode.trim().length > 0

  const descriptionText =
    item.description ??
    'Block available in the toolbox to compose the program visually.'
  const inputText = item.inputs ?? 'None'
  const outputText = item.outputs ?? 'None'

  /**
   * Derive category-tinted accent colours for the pill and "View" button.
   * Falls back to the shared placeholder slate (blocksColours.placeholder)
   * when a block has no category colour, instead of a one-off hardcoded blue
   * — same derivation pipeline either way, just a different input colour.
   */
  const categoryAccentColors = useMemo(() => {
    const rgb =
      (categoryColour && parseHexColor(categoryColour)) ||
      parseHexColor(blocksColours.placeholder)

    if (!rgb) {
      // parseHexColor only fails on malformed input; blocksColours.placeholder
      // is a valid literal, so this is unreachable in practice.
      return {
        pillBackgroundColor: 'transparent',
        pillBorderColor: 'transparent',
        pillTextColor: 'inherit',
        buttonBackgroundColor: 'transparent',
        buttonBorderColor: 'transparent',
        buttonHoverBackgroundColor: 'transparent',
        buttonTextColor: 'inherit',
      }
    }

    const pillText = darkenRgb(rgb, 0.28)

    return {
      pillBackgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.14)`,
      pillBorderColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`,
      pillTextColor: `rgb(${pillText.r}, ${pillText.g}, ${pillText.b})`,
      buttonBackgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.14)`,
      buttonBorderColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.45)`,
      buttonHoverBackgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.24)`,
      buttonTextColor: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
    }
  }, [categoryColour])

  const previewCategoryBadge = useMemo(
    () => getPreviewCategoryBadgeMeta(item.type, categoryName),
    [categoryName, item.type],
  )

  /** Claim ownership of the singleton workspace and schedule a render. */
  const handleOpen = () => {
    setIsOpen(true)
    activeTooltipOwner = ownerRef.current
    scheduleSingletonRender(
      ownerRef.current,
      item,
      () => previewMountRef.current,
      blockViewMode,
    )
  }

  /** Release ownership and park the singleton workspace off-screen. */
  const handleClose = () => {
    setIsOpen(false)
    if (activeTooltipOwner !== ownerRef.current) return
    cancelSingletonRender()
    activeTooltipOwner = null
    parkPreviewHost()
  }

  const handleOpenMacroPreview = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setIsModalOpen(true)
    },
    [],
  )

  const handleCloseMacroPreview = useCallback(() => {
    setIsModalOpen(false)
  }, [])

  // When a drag starts from the toolbox, close the tooltip immediately so it
  // does not linger over the workspace during the drag gesture.
  useEffect(() => {
    const owner = ownerRef.current
    const handleDragStart = () => {
      setIsOpen(false)
      if (activeTooltipOwner === owner) {
        cancelSingletonRender()
        activeTooltipOwner = null
        parkPreviewHost()
      }
    }
    window.addEventListener('toolboxDragStart', handleDragStart)
    return () => {
      window.removeEventListener('toolboxDragStart', handleDragStart)
    }
  }, [])

  useEffect(() => {
    if (!isOpen || activeTooltipOwner !== ownerRef.current) return

    scheduleSingletonRender(
      ownerRef.current,
      item,
      () => previewMountRef.current,
      blockViewMode,
    )
  }, [blockViewMode, isOpen, item])

  // Release singleton ownership when the component unmounts.
  useEffect(() => {
    const owner = ownerRef.current
    return () => {
      if (activeTooltipOwner === owner) {
        cancelSingletonRender()
        activeTooltipOwner = null
        parkPreviewHost()
      }
    }
  }, [])

  return (
    <>
      <Tooltip
        open={isOpen}
        title={
          <div className="toolbox-preview-card">
            <div className="toolbox-preview-card__header">
              <p className="toolbox-preview-card__title">{item.label}</p>
              <span
                className="toolbox-preview-card__category-pill"
                style={{
                  backgroundColor: categoryAccentColors.pillBackgroundColor,
                  borderColor: categoryAccentColors.pillBorderColor,
                  color: categoryAccentColors.pillTextColor,
                }}
              >
                {previewCategoryBadge.Icon && (
                  <previewCategoryBadge.Icon
                    size={13}
                    className="toolbox-preview-card__category-pill-icon"
                    aria-hidden="true"
                  />
                )}
                {previewCategoryBadge.label}
              </span>
            </div>

            <div className="toolbox-preview-card__preview">
              <div className="toolbox-preview__mount" ref={previewMountRef} />
            </div>

            <div className="toolbox-preview-card__body">
              <p
                className="toolbox-preview-card__description"
                style={{ whiteSpace: 'pre-wrap', lineHeight: '1.4' }}
              >
                {descriptionText}
              </p>
              <div className="toolbox-preview-card__io">
                <span className="toolbox-preview-card__io-line">
                  <SquareArrowRightEnter size={16} />
                  Input: {inputText}
                </span>
                <span className="toolbox-preview-card__io-line">
                  <SquareArrowRightExit size={16} />
                  Output: {outputText}
                </span>
              </div>

              {isMacroPreviewAvailable && (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={handleOpenMacroPreview}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    width: '100%',
                    marginTop: '12px',
                    padding: '8px 12px',
                    border: `1px solid ${categoryAccentColors.buttonBorderColor}`,
                    borderRadius: '6px',
                    backgroundColor: categoryAccentColors.buttonBackgroundColor,
                    color: categoryAccentColors.buttonTextColor,
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    fontFamily: 'inherit',
                  }}
                  onMouseOver={(e) =>
                    (e.currentTarget.style.backgroundColor =
                      categoryAccentColors.buttonHoverBackgroundColor)
                  }
                  onFocus={(e) =>
                    (e.currentTarget.style.backgroundColor =
                      categoryAccentColors.buttonHoverBackgroundColor)
                  }
                  onMouseOut={(e) =>
                    (e.currentTarget.style.backgroundColor =
                      categoryAccentColors.buttonBackgroundColor)
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.backgroundColor =
                      categoryAccentColors.buttonBackgroundColor)
                  }
                >
                  <Eye size={16} />
                  View Task Blocks
                </button>
              )}
            </div>

            <div
              className="toolbox-preview-card__footer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Pointer size={16} />
              <span className="toolbox-preview-card__footer-text">
                Drag to add to program
              </span>
            </div>
          </div>
        }
        arrow
        placement="right-start"
        enterDelay={200}
        leaveDelay={80}
        onOpen={handleOpen}
        onClose={handleClose}
        disableFocusListener
        disableTouchListener
        slotProps={{
          popper: { className: 'toolbox-preview-popper' },
          tooltip: { className: 'toolbox-preview-tooltip' },
        }}
      >
        {children}
      </Tooltip>

      {isMacroPreviewAvailable && item.macroCode && (
        <MacroPreviewModal
          isOpen={isModalOpen}
          onClose={handleCloseMacroPreview}
          macroName={item.label}
          macroDescription={item.description}
          macroCode={item.macroCode}
          blockViewMode={blockViewMode}
        />
      )}
    </>
  )
}
