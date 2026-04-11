import {
  type MouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import ModernTheme from '@blockly/theme-modern'
import {
  Eye,
  Pointer,
  SquareArrowRightEnter,
  SquareArrowRightExit,
  X,
} from 'lucide-react'

import { abstractToBlockly } from 'utils/blocklyParser'
import { BlockState as State } from 'utils/blocklyTypes'

import { ToolboxBlockItem } from './toolboxRegistry'
import './BlockPreviewTooltip.css'

interface BlockPreviewTooltipProps {
  item: ToolboxBlockItem
  categoryName?: string
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

const parseJson = <T,>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

const isBlockState = (value: unknown): value is State => {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

const toMacroRootState = (macroCode: string): State | null => {
  try {
    const parsed = parseJson<any>(macroCode)
    if (!parsed) return null

    if (Array.isArray(parsed) || Array.isArray(parsed.steps)) {
      const steps = Array.isArray(parsed) ? parsed : parsed.steps
      const converted = abstractToBlockly(steps as any, [], [], [])
      return isBlockState(converted) ? converted : null
    }

    if (typeof parsed.type === 'string') {
      return parsed as State
    }

    if (Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
      const firstBlock = parsed.blocks[0]
      return isBlockState(firstBlock) ? firstBlock : null
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
  macroCode: string
}

const MacroPreviewModal = ({
  isOpen,
  onClose,
  macroName,
  macroCode,
}: MacroPreviewModalProps) => {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null)

  useEffect(() => {
    if (!isOpen) return

    let isCancelled = false
    let bootstrapRafId: number | null = null

    const renderWorkspace = (container: HTMLDivElement) => {
      container.innerHTML = ''

      const workspace = Blockly.inject(container, {
        renderer: 'thrasos',
        readOnly: true,
        trashcan: false,
        media: '/blocklyMedia',
        move: { drag: true, wheel: true, scrollbars: true },
        zoom: {
          controls: true,
          wheel: true,
          pinch: true,
          startScale: 0.9,
          maxScale: 2,
          minScale: 0.3,
          scaleSpeed: 1.2,
        },
        theme: ModernTheme,
      })
      workspaceRef.current = workspace

      const parsed = parseJson<any>(macroCode)
      let injected = false

      if (
        parsed &&
        typeof parsed === 'object' &&
        parsed.blocks &&
        parsed.blocks.blocks
      ) {
        Blockly.serialization.workspaces.load(parsed, workspace)
        injected = true
      } else {
        const state = toMacroRootState(macroCode)
        if (state) {
          Blockly.serialization.blocks.append(state, workspace)
          injected = true
        }
      }

      if (!injected) {
        return
      }

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (isCancelled || workspaceRef.current !== workspace) {
            return
          }
          Blockly.svgResize(workspace)
          workspace.scrollCenter()
        })
      })
    }

    const bootstrapWhenReady = () => {
      if (isCancelled) {
        return
      }

      const container = mountRef.current
      const isReady =
        !!container &&
        container.isConnected &&
        container.clientWidth > 0 &&
        container.clientHeight > 0

      if (!isReady) {
        bootstrapRafId = window.requestAnimationFrame(bootstrapWhenReady)
        return
      }

      try {
        renderWorkspace(container)
      } catch {
        // Keep modal open even when preview cannot be rendered.
      }
    }

    bootstrapRafId = window.requestAnimationFrame(bootstrapWhenReady)

    const handleResize = () => {
      if (workspaceRef.current) Blockly.svgResize(workspaceRef.current)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      isCancelled = true
      if (bootstrapRafId !== null) {
        window.cancelAnimationFrame(bootstrapRafId)
      }
      window.removeEventListener('resize', handleResize)
      if (workspaceRef.current) {
        workspaceRef.current.dispose()
        workspaceRef.current = null
      }
    }
  }, [isOpen, macroCode])

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="macro-preview-dialog-title"
    >
      <DialogTitle
        id="macro-preview-dialog-title"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #E2E8F0',
          backgroundColor: '#FFFFFF',
        }}
      >
        <Typography component="span" sx={{ fontWeight: 600 }}>
          Internal structure: {macroName}
        </Typography>
        <IconButton aria-label="Chiudi" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 0, overflow: 'hidden' }}>
        <div
          ref={mountRef}
          style={{
            width: '100%',
            height: '600px',
            backgroundColor: '#F8FAFC',
          }}
        />
      </DialogContent>
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
  singletonWorkspace = Blockly.inject(host, {
    renderer: 'thrasos',
    readOnly: true,
    trashcan: false,
    media: '/blocklyMedia',
    move: { drag: false, wheel: false, scrollbars: false },
    zoom: {
      controls: false,
      wheel: false,
      pinch: false,
      startScale: 1,
      maxScale: 2,
      minScale: 0.3,
      scaleSpeed: 1,
    },
    grid: { spacing: 0, length: 0, colour: '#FFFFFF', snap: false },
    sounds: false,
    collapse: false,
    comments: false,
    theme: ModernTheme,
  })

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
              <span className="toolbox-preview-card__category">
                [{categoryName ?? 'Toolbox'}]
              </span>
              <p className="toolbox-preview-card__title">{item.label}</p>
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
                    border: '1px solid #BFDBFE',
                    borderRadius: '6px',
                    backgroundColor: '#EFF6FF',
                    color: '#1E3A8A',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    fontFamily: 'inherit',
                  }}
                  onMouseOver={(e) =>
                    (e.currentTarget.style.backgroundColor = '#DBEAFE')
                  }
                  onMouseOut={(e) =>
                    (e.currentTarget.style.backgroundColor = '#EFF6FF')
                  }
                >
                  <Eye size={16} />
                  Explore Macro Structure
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
          macroCode={item.macroCode}
        />
      )}
    </>
  )
}
