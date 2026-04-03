import { useEffect, useRef } from 'react'
import Tooltip from '@mui/material/Tooltip'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import ModernTheme from '@blockly/theme-modern'
import { State } from 'blockly/core/serialization/blocks'

import { ToolboxBlockItem } from './toolboxRegistry'

interface BlockPreviewTooltipProps {
  item: ToolboxBlockItem
  children: JSX.Element
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
    move: {
      drag: false,
      wheel: false,
      scrollbars: false,
    },
    zoom: {
      controls: false,
      wheel: false,
      pinch: false,
      startScale: 1,
      maxScale: 1,
      minScale: 1,
      scaleSpeed: 1,
    },
    grid: {
      spacing: 0,
      length: 0,
      colour: '#FFFFFF',
      snap: false,
    },
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

const centerTopBlock = (
  workspace: Blockly.WorkspaceSvg,
  container: HTMLElement,
) => {
  const [topBlock] = workspace.getTopBlocks(true)
  if (!topBlock) return

  const blockSize = topBlock.getHeightWidth()
  const bounds = container.getBoundingClientRect()

  const targetX = Math.max(12, (bounds.width - blockSize.width) / 2)
  const targetY = Math.max(12, (bounds.height - blockSize.height) / 2)

  const current = topBlock.getRelativeToSurfaceXY()
  topBlock.moveBy(targetX - current.x, targetY - current.y)
}

const renderPreviewBlock = (item: ToolboxBlockItem, container: HTMLElement) => {
  const workspace = mountPreviewHost(container)
  workspace.clear()

  try {
    Blockly.serialization.blocks.append(createPreviewState(item), workspace)
  } catch {
    Blockly.serialization.blocks.append(
      {
        type: item.type,
        x: 0,
        y: 0,
      },
      workspace,
    )
  }

  // Force SVG recalculation after moving the singleton host into the new tooltip DOM.
  Blockly.svgResize(workspace)
  centerTopBlock(workspace, container)
  Blockly.svgResize(workspace)
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
  children,
}: BlockPreviewTooltipProps) => {
  const previewMountRef = useRef<HTMLDivElement | null>(null)
  const ownerRef = useRef(Symbol('block-preview-tooltip-owner'))

  const handleOpen = () => {
    activeTooltipOwner = ownerRef.current
    scheduleSingletonRender(
      ownerRef.current,
      item,
      () => previewMountRef.current,
    )
  }

  const handleClose = () => {
    if (activeTooltipOwner !== ownerRef.current) {
      return
    }

    cancelSingletonRender()
    activeTooltipOwner = null
    parkPreviewHost()
  }

  useEffect(() => {
    return () => {
      if (activeTooltipOwner === ownerRef.current) {
        cancelSingletonRender()
        activeTooltipOwner = null
        parkPreviewHost()
      }
    }
  }, [])

  return (
    <Tooltip
      title={
        <div className="toolbox-preview">
          <div className="toolbox-preview__mount" ref={previewMountRef} />
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
        tooltip: {
          className: 'toolbox-preview-tooltip',
        },
      }}
    >
      {children}
    </Tooltip>
  )
}
