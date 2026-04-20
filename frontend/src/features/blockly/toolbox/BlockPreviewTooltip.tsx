import {
  type MouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Dialog,
  DialogTitle,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import {
  Eye,
  FlaskConical,
  MapPin,
  Pointer,
  SquareArrowRightEnter,
  SquareArrowRightExit,
  Zap,
  X,
} from 'lucide-react'

import { abstractToBlockly } from 'utils/blocklyParser'
import { BlockState as State } from 'utils/blocklyTypes'
import { type AbstractStep } from 'pages/tasks/types'

import { BlocklyViewerWithControls } from '../workspace'
import { isValidBlockState, parseJson } from '../utils/serialization'
import { PREVIEW_WORKSPACE_CONFIG } from '../workspace/workspaceConfig'
import '../styles/editor.css'

import { ToolboxBlockItem } from './toolboxRegistry'
import './BlockPreviewTooltip.css'

interface BlockPreviewTooltipProps {
  item: ToolboxBlockItem
  categoryName?: string
  categoryColour?: string
  children: ReactElement
}

const PREVIEW_WIDTH = 260
const PREVIEW_HEIGHT = 140
const PREVIEW_RENDER_DELAY_MS = 24
const PREVIEW_RENDER_MAX_ATTEMPTS = 3

let singletonParkingRoot: HTMLDivElement | null = null
let singletonHost: HTMLDivElement | null = null
let singletonWorkspace: Blockly.WorkspaceSvg | null = null
let singletonRenderTimeout: number | null = null
let singletonRenderRaf: number | null = null
let singletonRenderRequestId = 0
let activeTooltipOwner: symbol | null = null

const getPreviewCategoryBadgeMeta = (
  itemType: string,
  fallbackCategoryName?: string,
) => {
  switch (itemType) {
    case 'object_block':
      return {
        label: 'Parts',
        Icon: FlaskConical,
      }
    case 'location_block':
      return {
        label: 'Destinations',
        Icon: MapPin,
      }
    case 'action_block':
      return {
        label: 'Custom Skills',
        Icon: Zap,
      }
    default:
      return {
        label: fallbackCategoryName ?? 'Toolbox',
        Icon: null,
      }
  }
}

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

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const isAbstractStepLike = (value: unknown): value is AbstractStep => {
  return (
    isRecord(value) && typeof (value as { type?: unknown }).type === 'string'
  )
}

const isAbstractStepArray = (value: unknown): value is AbstractStep[] => {
  return Array.isArray(value) && value.every(isAbstractStepLike)
}

const hasAbstractStepsArray = (
  value: unknown,
): value is { steps: AbstractStep[] } => {
  return (
    isRecord(value) && isAbstractStepArray((value as { steps?: unknown }).steps)
  )
}

const hasWorkspaceBlocksPayload = (
  value: unknown,
): value is { blocks: { blocks: unknown[] } } => {
  return (
    isRecord(value) &&
    isRecord(value.blocks) &&
    Array.isArray((value.blocks as { blocks?: unknown }).blocks)
  )
}

const hasTopLevelBlocksArray = (
  value: unknown,
): value is { blocks: unknown[] } => {
  return (
    isRecord(value) && Array.isArray((value as { blocks?: unknown }).blocks)
  )
}

const toMacroRootState = (macroCode: string): State | null => {
  try {
    const parsed = parseJson<unknown>(macroCode)
    if (!parsed) return null

    if (isAbstractStepArray(parsed) || hasAbstractStepsArray(parsed)) {
      const steps = isAbstractStepArray(parsed) ? parsed : parsed.steps
      const converted = abstractToBlockly(steps, [], [], [])
      return isValidBlockState(converted) ? converted : null
    }

    if (isValidBlockState(parsed)) {
      return parsed
    }

    if (hasWorkspaceBlocksPayload(parsed)) {
      const blocks = parsed.blocks.blocks
      if (blocks.length > 0 && isValidBlockState(blocks[0])) {
        return blocks[0]
      }
    }

    if (hasTopLevelBlocksArray(parsed) && parsed.blocks.length > 0) {
      const firstBlock = parsed.blocks[0]
      return isValidBlockState(firstBlock) ? firstBlock : null
    }
  } catch (e) {
    console.error('Failed to parse macro code for preview:', e)
  }
  return null
}

interface MacroPreviewModalProps {
  isOpen: boolean
  onClose: () => void
  macroName: string
  macroDescription?: string
  macroCode: string
}

const MacroPreviewModal = ({
  isOpen,
  onClose,
  macroName,
  macroDescription,
  macroCode,
}: MacroPreviewModalProps) => {
  const macroState = toMacroRootState(macroCode)
  const resolvedMacroDescription =
    typeof macroDescription === 'string' && macroDescription.trim().length > 0
      ? macroDescription.trim()
      : 'No description available for this routine.'

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="macro-preview-dialog-title"
      slotProps={{
        paper: {
          sx: {
            overflow: 'hidden',
            borderRadius: 2,
            border: '1px solid #E2E8F0',
            boxShadow:
              '0 20px 50px rgba(15, 23, 42, 0.2), 0 6px 16px rgba(15, 23, 42, 0.12)',
          },
        },
      }}
    >
      <DialogTitle
        id="macro-preview-dialog-title"
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: '1px solid #E2E8F0',
          background:
            'linear-gradient(180deg, #FFFFFF 0%, rgba(248, 250, 252, 0.92) 100%)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            width: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              minWidth: 0,
            }}
          >
            <Typography
              component="h2"
              sx={{
                m: 0,
                fontSize: '1.08rem',
                fontWeight: 800,
                lineHeight: 1.2,
                color: '#0F172A',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              Saved Routine: {macroName}
            </Typography>
            <Typography
              component="p"
              sx={{
                m: 0,
                fontSize: '0.78rem',
                fontWeight: 500,
                lineHeight: 1.4,
                color: '#475569',
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 2,
                overflow: 'hidden',
              }}
            >
              {resolvedMacroDescription}
            </Typography>
          </div>
          <IconButton
            aria-label="Close"
            onClick={onClose}
            size="small"
            className="workspace-control-button"
          >
            <X size={18} />
          </IconButton>
        </div>
      </DialogTitle>
      <div
        style={{
          width: '100%',
          height: '450px',
          backgroundColor: '#F8FAFC',
          padding: 0,
          overflow: 'hidden',
        }}
      >
        <BlocklyViewerWithControls
          blockState={macroState}
          height="450px"
          startScale={1.2}
          autoCenter
          autoFit
        />
      </div>
    </Dialog>
  )
}

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

const ensureWorkspace = () => {
  if (singletonWorkspace) return singletonWorkspace

  const host = ensureHost()
  singletonWorkspace = Blockly.inject(host, PREVIEW_WORKSPACE_CONFIG)

  return singletonWorkspace
}

const parkPreviewHost = () => {
  if (!singletonHost || !singletonParkingRoot) return

  if (singletonHost.parentElement !== singletonParkingRoot) {
    singletonParkingRoot.appendChild(singletonHost)
  }
}

const mountPreviewHost = (container: HTMLElement) => {
  const host = ensureHost()
  if (host.parentElement !== container) {
    container.appendChild(host)
  }

  return ensureWorkspace()
}

const createPreviewState = (item: ToolboxBlockItem): State => ({
  type: item.type,
  x: 0,
  y: 0,
  fields: item.fields,
  data: item.data,
})

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

const renderPreviewBlock = (item: ToolboxBlockItem, container: HTMLElement) => {
  const workspace = mountPreviewHost(container)
  workspace.clear()

  try {
    Blockly.serialization.blocks.append(createPreviewState(item), workspace)
  } catch {
    Blockly.serialization.blocks.append(
      { type: item.type, x: 0, y: 0 },
      workspace,
    )
  }

  Blockly.svgResize(workspace)

  singletonRenderRaf = window.requestAnimationFrame(() => {
    singletonRenderRaf = window.requestAnimationFrame(() => {
      singletonRenderRaf = null
      Blockly.svgResize(workspace)
      fitAndCenterTopBlock(workspace, container)
    })
  })
}

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

const scheduleSingletonRender = (
  owner: symbol,
  item: ToolboxBlockItem,
  resolveContainer: () => HTMLDivElement | null,
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

        renderPreviewBlock(item, container)
      })
    }, PREVIEW_RENDER_DELAY_MS)
  }

  tryRender(0)
}

export const BlockPreviewTooltip = ({
  item,
  categoryName,
  categoryColour,
  children,
}: BlockPreviewTooltipProps) => {
  const previewMountRef = useRef<HTMLDivElement | null>(null)
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

  const categoryAccentColors = useMemo(() => {
    const fallback = {
      pillBackgroundColor: '#EFF6FF',
      pillBorderColor: '#BFDBFE',
      pillTextColor: '#1D4ED8',
      buttonBackgroundColor: '#EFF6FF',
      buttonBorderColor: '#BFDBFE',
      buttonHoverBackgroundColor: '#DBEAFE',
      buttonTextColor: '#1E3A8A',
    }

    if (!categoryColour) {
      return fallback
    }

    const rgb = parseHexColor(categoryColour)
    if (!rgb) {
      return fallback
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

  const handleOpen = () => {
    setIsOpen(true)
    activeTooltipOwner = ownerRef.current
    scheduleSingletonRender(
      ownerRef.current,
      item,
      () => previewMountRef.current,
    )
  }

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
                  onMouseOut={(e) =>
                    (e.currentTarget.style.backgroundColor =
                      categoryAccentColors.buttonBackgroundColor)
                  }
                >
                  <Eye size={16} />
                  View Routine Blocks
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
        />
      )}
    </>
  )
}
