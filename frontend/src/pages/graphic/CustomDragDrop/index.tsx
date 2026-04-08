import * as Blockly from 'blockly/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActionListType } from 'pages/actions/types'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { State } from 'blockly/core/serialization/blocks'
import {
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from '@mui/material'
import {
  Check,
  CircleHelp,
  ClipboardPaste,
  Copy,
  Maximize,
  /*MessageSquare,
  MessageSquarePlus,
  MessageSquareX,*/
  Minimize2,
  Minus,
  Pencil,
  Plus,
  Redo2,
  Scissors,
  Settings,
  Settings2,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import BlocklyComponent from './Blockly'
import { CustomToolbox, ToolboxBlockItem } from './CustomToolbox'
import './CustomCategory'
import './CustomDragDropStyle.css'

const DRAG_THRESHOLD_PX = 5

const getMenuOptionText = (text: string | HTMLElement | undefined) => {
  if (typeof text === 'string') {
    return text
  }

  if (text instanceof HTMLElement) {
    return (text.innerText || text.textContent || '').trim()
  }

  return ''
}

const getMenuIconInfo = (text: string) => {
  const normalized = text.toLowerCase()
  const containsAny = (terms: string[]) =>
    terms.some((term) => normalized.includes(term))

  if (containsAny(['delete', 'elimina', 'cancella'])) {
    return { Icon: Trash2, color: '#DC2626' }
  }

  if (containsAny(['duplicate', 'duplica', 'copy', 'copia'])) {
    return { Icon: Copy, color: '#2563EB' }
  }

  if (containsAny(['cut', 'taglia'])) {
    return { Icon: Scissors, color: '#0891B2' }
  }

  if (containsAny(['paste', 'incolla'])) {
    return { Icon: ClipboardPaste, color: '#0F766E' }
  }

  /*if (containsAny(['add comment', 'aggiungi commento'])) {
    return { Icon: MessageSquarePlus, color: '#7C3AED' }
  }

  if (containsAny(['remove comment', 'rimuovi commento'])) {
    return { Icon: MessageSquareX, color: '#475569' }
  }

  if (containsAny(['commento', 'comment'])) {
    return { Icon: MessageSquare, color: '#6366F1' }
  }*/

  if (containsAny(['undo', 'annulla'])) {
    return { Icon: Undo2, color: '#334155' }
  }

  if (containsAny(['redo', 'ripeti'])) {
    return { Icon: Redo2, color: '#334155' }
  }

  if (containsAny(['expand block', 'espandi blocco', 'expand', 'espandi'])) {
    return { Icon: Maximize, color: '#0F766E' }
  }

  if (
    containsAny(['collapse block', 'comprimi blocco', 'collapse', 'comprimi'])
  ) {
    return { Icon: Minimize2, color: '#0F766E' }
  }

  if (containsAny(['enable block', 'attiva blocco', 'enable', 'attiva'])) {
    return { Icon: Check, color: '#15803D' }
  }

  if (
    containsAny(['disable block', 'disattiva blocco', 'disable', 'disattiva'])
  ) {
    return { Icon: X, color: '#B91C1C' }
  }

  if (containsAny(['rename', 'rinomina', 'modifica'])) {
    return { Icon: Pencil, color: '#7C2D12' }
  }

  if (
    containsAny([
      'inline inputs',
      'ingressi in linea',
      'external inputs',
      'ingressi esterni',
    ])
  ) {
    return { Icon: Settings2, color: '#334155' }
  }

  if (containsAny(['clean up', 'pulisci i blocchi', 'pulisci'])) {
    return { Icon: Settings, color: '#475569' }
  }

  if (containsAny(['help', 'aiuto'])) {
    return { Icon: CircleHelp, color: '#4F46E5' }
  }

  if (containsAny(['add ', 'aggiungi '])) {
    return { Icon: Plus, color: '#2563EB' }
  }

  if (containsAny(['remove ', 'rimuovi '])) {
    return { Icon: Minus, color: '#475569' }
  }

  return { Icon: CircleHelp, color: '#64748B' }
}

class CustomToolboxDeleteArea extends Blockly.DeleteArea {
  private readonly toolboxElement: HTMLElement

  constructor(toolboxElement: HTMLElement) {
    super()
    this.toolboxElement = toolboxElement
    this.id = 'custom-toolbox-delete-area'
  }

  override getClientRect(): Blockly.utils.Rect | null {
    if (!this.toolboxElement.isConnected) {
      return null
    }

    const toolboxRect = this.toolboxElement.getBoundingClientRect()
    if (toolboxRect.width <= 0 || toolboxRect.height <= 0) {
      return null
    }

    // Mirror Blockly's native left-toolbox delete zone behaviour.
    const BIG_NUM = 10000000
    return new Blockly.utils.Rect(
      toolboxRect.top,
      toolboxRect.bottom,
      -BIG_NUM,
      toolboxRect.right,
    )
  }

  override onDragEnter(dragElement: Blockly.IDraggable) {
    super.onDragEnter(dragElement)
    this.toolboxElement.classList.add('custom-toolbox--delete-over')
  }

  override onDragExit(dragElement: Blockly.IDraggable) {
    super.onDragExit(dragElement)
    this.toolboxElement.classList.remove('custom-toolbox--delete-over')
  }

  override onDrop(dragElement: Blockly.IDraggable) {
    super.onDrop(dragElement)
    this.toolboxElement.classList.remove('custom-toolbox--delete-over')
  }
}

interface CustomDragDropProps {
  dataLocations: LocationListType[]
  dataObjects: ObjectListType[]
  dataActions: ActionListType[]
  dataTask: State
}

export const CustomDragDrop = ({
  dataLocations,
  dataObjects,
  dataActions,
  dataTask,
}: CustomDragDropProps) => {
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null)
  const toolboxRootRef = useRef<HTMLElement | null>(null)
  const deleteAreaRef = useRef<CustomToolboxDeleteArea | null>(null)
  const deleteAreaWorkspaceRef = useRef<Blockly.WorkspaceSvg | null>(null)
  const workspaceChangeListenerRef = useRef<
    ((event: Blockly.Events.Abstract) => void) | null
  >(null)
  const pendingDragCleanupRef = useRef<(() => void) | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  })
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number
    mouseY: number
    options: any[]
  } | null>(null)

  const syncHistoryState = useCallback(
    (workspace: Blockly.WorkspaceSvg | null) => {
      if (!workspace) {
        setHistoryState({ canUndo: false, canRedo: false })
        return
      }

      setHistoryState({
        canUndo: workspace.getUndoStack().length > 0,
        canRedo: workspace.getRedoStack().length > 0,
      })
    },
    [],
  )

  const unregisterToolboxDeleteArea = useCallback(() => {
    const registeredWorkspace = deleteAreaWorkspaceRef.current
    const registeredDeleteArea = deleteAreaRef.current

    if (!registeredWorkspace || !registeredDeleteArea) {
      return
    }

    try {
      registeredWorkspace
        .getComponentManager()
        .removeComponent(registeredDeleteArea.id)
      registeredWorkspace.recordDragTargets()
    } catch {
      // Ignore stale-component edge cases during workspace teardown.
    }

    toolboxRootRef.current?.classList.remove('custom-toolbox--delete-over')
    deleteAreaRef.current = null
    deleteAreaWorkspaceRef.current = null
  }, [])

  const registerToolboxDeleteArea = useCallback(
    (
      workspace: Blockly.WorkspaceSvg | null,
      toolboxElement: HTMLElement | null,
    ) => {
      unregisterToolboxDeleteArea()

      if (!workspace || !toolboxElement || workspace.options.readOnly) {
        return
      }

      const deleteArea = new CustomToolboxDeleteArea(toolboxElement)

      workspace.getComponentManager().addComponent(
        {
          component: deleteArea,
          capabilities: [
            Blockly.ComponentManager.Capability.DRAG_TARGET,
            Blockly.ComponentManager.Capability.DELETE_AREA,
          ],
          weight: Blockly.ComponentManager.ComponentWeight.TOOLBOX_WEIGHT,
        },
        true,
      )

      workspace.recordDragTargets()
      deleteAreaRef.current = deleteArea
      deleteAreaWorkspaceRef.current = workspace
    },
    [unregisterToolboxDeleteArea],
  )

  const detachWorkspaceListener = useCallback(() => {
    const workspace = workspaceRef.current
    const listener = workspaceChangeListenerRef.current

    if (workspace && listener) {
      workspace.removeChangeListener(listener)
    }

    workspaceChangeListenerRef.current = null
  }, [])

  const startSyntheticBlockDrag = (
    pointerEvent: PointerEvent,
    sourceElement: HTMLDivElement,
    item: ToolboxBlockItem,
    workspace: Blockly.WorkspaceSvg,
  ) => {
    const hasFields = !!item.fields && Object.keys(item.fields).length > 0
    const hasData = typeof item.data === 'string' && item.data.length > 0

    const blockState: State = {
      type: item.type,
      ...(hasFields ? { fields: item.fields } : {}),
      ...(hasData ? { data: item.data } : {}),
    }

    try {
      // 1. Turn off History to hide initial micro-movements.
      Blockly.Events.disable()

      let block: Blockly.BlockSvg | null = null
      try {
        block = Blockly.serialization.blocks.append(
          blockState,
          workspace,
        ) as Blockly.BlockSvg

        block.initSvg()
        block.render()

        const screenCoordinates = new Blockly.utils.Coordinate(
          pointerEvent.clientX,
          pointerEvent.clientY,
        )
        const workspaceCoords = Blockly.utils.svgMath.screenToWsCoordinates(
          workspace,
          screenCoordinates,
        )
        block.moveTo(
          new Blockly.utils.Coordinate(
            workspaceCoords.x - 20,
            workspaceCoords.y - 20,
          ),
        )
      } finally {
        // 2. Rekindle History.
        Blockly.Events.enable()
      }

      if (!block) {
        return
      }

      // 3. Record a single official creation event.
      if (Blockly.Events.isEnabled()) {
        Blockly.Events.fire(new Blockly.Events.BlockCreate(block))
      }

      // 4. Proceed with Synthetic Event Routing.
      if (sourceElement.hasPointerCapture(pointerEvent.pointerId)) {
        sourceElement.releasePointerCapture(pointerEvent.pointerId)
      }

      const svgRoot = block.getSvgRoot()
      const syntheticEvent = new PointerEvent('pointerdown', {
        clientX: pointerEvent.clientX,
        clientY: pointerEvent.clientY,
        pointerId: pointerEvent.pointerId,
        button: 0,
        bubbles: true,
        cancelable: true,
        pointerType: pointerEvent.pointerType,
        isPrimary: pointerEvent.isPrimary,
      })

      svgRoot.dispatchEvent(syntheticEvent)
    } catch (error) {
      console.error('Blockly Gesture Proxy Error:', error)
    }
  }

  useEffect(() => {
    const originalContextMenuShow = Blockly.ContextMenu.show
    const originalContextMenuHide = Blockly.ContextMenu.hide
    const blockPrototype = Blockly.BlockSvg?.prototype as unknown as {
      showContextMenu?: (event: Event) => void
      generateContextMenu?: (event: Event) => any[] | null
      workspace?: Blockly.WorkspaceSvg
    }
    const workspacePrototype = Blockly.WorkspaceSvg?.prototype as unknown as {
      showContextMenu?: (event: Event) => void
      configureContextMenu?: ((menuOptions: any[], e: Event) => void) | null
      options?: {
        readOnly?: boolean
      }
      isReadOnly?: () => boolean
      isFlyout?: boolean
    }
    const connectionPrototype = (Blockly.RenderedConnection as any)
      ?.prototype as unknown as {
      showContextMenu?: (event: Event) => void
      getSourceBlock?: () => Blockly.BlockSvg
    }

    const originalBlockShowContextMenu =
      typeof blockPrototype?.showContextMenu === 'function'
        ? blockPrototype.showContextMenu
        : null
    const originalWorkspaceShowContextMenu =
      typeof workspacePrototype?.showContextMenu === 'function'
        ? workspacePrototype.showContextMenu
        : null
    const originalConnectionShowContextMenu =
      typeof connectionPrototype?.showContextMenu === 'function'
        ? connectionPrototype.showContextMenu
        : null

    const openMuiContextMenu = (
      menuOpenEvent: Event,
      menuOptions: any[] | null | undefined,
      fallbackScope?: Blockly.ContextMenuRegistry.Scope,
    ) => {
      menuOpenEvent.preventDefault()
      menuOpenEvent.stopPropagation()

      let mouseX = 0
      let mouseY = 0

      if ('clientX' in menuOpenEvent && 'clientY' in menuOpenEvent) {
        const mouseEvent = menuOpenEvent as MouseEvent
        mouseX = Number.isFinite(mouseEvent.clientX) ? mouseEvent.clientX : 0
        mouseY = Number.isFinite(mouseEvent.clientY) ? mouseEvent.clientY : 0
      } else if (workspaceRef.current) {
        const workspaceRect = workspaceRef.current
          .getInjectionDiv()
          .getBoundingClientRect()
        mouseX = Math.round(workspaceRect.left + workspaceRect.width / 2)
        mouseY = Math.round(workspaceRect.top + workspaceRect.height / 2)
      }

      const menuLocation = new Blockly.utils.Coordinate(mouseX, mouseY)

      const options = (menuOptions || [])
        .map((option) => {
          const actionOption = option as {
            text?: string | HTMLElement
            enabled?: boolean
            scope?: Blockly.ContextMenuRegistry.Scope
            callback?: (...args: any[]) => void
            separator?: boolean
          }

          if (!actionOption || actionOption.separator) {
            return null
          }

          const label = getMenuOptionText(actionOption.text)
          if (!label || typeof actionOption.callback !== 'function') {
            return null
          }

          if ('scope' in actionOption && actionOption.scope) {
            return {
              text: label,
              enabled: actionOption.enabled,
              callback: () => {
                actionOption.callback?.(
                  actionOption.scope,
                  menuOpenEvent,
                  new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    clientX: mouseX,
                    clientY: mouseY,
                  }),
                  menuLocation,
                )
              },
            }
          }

          return {
            text: label,
            enabled: actionOption.enabled,
            callback: () => {
              actionOption.callback?.(
                fallbackScope || (workspaceRef.current as any),
              )
            },
          }
        })
        .filter((option) => option !== null)

      setContextMenu(
        options.length > 0
          ? {
              mouseX,
              mouseY,
              options,
            }
          : null,
      )
    }

    Blockly.ContextMenu.show = function (menuOpenEvent, menuOptions, _rtl) {
      openMuiContextMenu(menuOpenEvent, menuOptions)
    }

    Blockly.ContextMenu.hide = function () {
      setContextMenu(null)
    }

    if (blockPrototype && originalBlockShowContextMenu) {
      blockPrototype.showContextMenu = function (event: Event) {
        const generatedOptions =
          typeof this.generateContextMenu === 'function'
            ? this.generateContextMenu(event)
            : null

        openMuiContextMenu(event, generatedOptions, {
          block: this as unknown as Blockly.BlockSvg,
          workspace: this.workspace,
          focusedNode: this as unknown as Blockly.BlockSvg,
        })
      }
    }

    if (workspacePrototype && originalWorkspaceShowContextMenu) {
      workspacePrototype.showContextMenu = function (event: Event) {
        const isReadOnly =
          typeof this.isReadOnly === 'function'
            ? this.isReadOnly()
            : this.options?.readOnly === true

        if (isReadOnly || this.isFlyout) {
          return
        }

        const menuOptions =
          Blockly.ContextMenuRegistry.registry.getContextMenuOptions(
            {
              workspace: this as unknown as Blockly.WorkspaceSvg,
              focusedNode: this as any,
            },
            event,
          )

        if (typeof this.configureContextMenu === 'function') {
          this.configureContextMenu(menuOptions, event)
        }

        openMuiContextMenu(event, menuOptions, {
          workspace: this as unknown as Blockly.WorkspaceSvg,
          focusedNode: this as any,
        })
      }
    }

    if (connectionPrototype && originalConnectionShowContextMenu) {
      connectionPrototype.showContextMenu = function (event: Event) {
        const sourceBlock =
          typeof this.getSourceBlock === 'function'
            ? this.getSourceBlock()
            : null

        const menuOptions =
          Blockly.ContextMenuRegistry.registry.getContextMenuOptions(
            {
              focusedNode: this as any,
              ...(sourceBlock ? { block: sourceBlock } : {}),
              ...(sourceBlock?.workspace
                ? { workspace: sourceBlock.workspace }
                : {}),
            },
            event,
          )

        openMuiContextMenu(event, menuOptions, {
          focusedNode: this as any,
          ...(sourceBlock ? { block: sourceBlock } : {}),
          ...(sourceBlock?.workspace
            ? { workspace: sourceBlock.workspace }
            : {}),
        })
      }
    }

    return () => {
      Blockly.ContextMenu.show = originalContextMenuShow
      Blockly.ContextMenu.hide = originalContextMenuHide
      if (blockPrototype && originalBlockShowContextMenu) {
        blockPrototype.showContextMenu = originalBlockShowContextMenu
      }
      if (workspacePrototype && originalWorkspaceShowContextMenu) {
        workspacePrototype.showContextMenu = originalWorkspaceShowContextMenu
      }
      if (connectionPrototype && originalConnectionShowContextMenu) {
        connectionPrototype.showContextMenu = originalConnectionShowContextMenu
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      pendingDragCleanupRef.current?.()
      pendingDragCleanupRef.current = null
      setIsDeleting(false)
      setContextMenu(null)
      detachWorkspaceListener()
      unregisterToolboxDeleteArea()
      workspaceRef.current = null
    }
  }, [detachWorkspaceListener, unregisterToolboxDeleteArea])

  const handleWorkspaceReady = useCallback(
    (workspace: Blockly.WorkspaceSvg | null) => {
      detachWorkspaceListener()
      unregisterToolboxDeleteArea()
      workspaceRef.current = workspace

      if (!workspace) {
        setIsDeleting(false)
        syncHistoryState(null)
        return
      }

      const listener = (event: Blockly.Events.Abstract) => {
        syncHistoryState(workspace)

        if (event.type !== Blockly.Events.BLOCK_DRAG) {
          return
        }

        const dragEvent = event as Blockly.Events.Abstract & {
          isStart?: boolean
        }

        if (dragEvent.isStart === true) {
          setIsDeleting(true)
        } else if (dragEvent.isStart === false) {
          setIsDeleting(false)
        }
      }
      workspace.addChangeListener(listener)
      workspaceChangeListenerRef.current = listener

      syncHistoryState(workspace)
      registerToolboxDeleteArea(workspace, toolboxRootRef.current)
    },
    [
      detachWorkspaceListener,
      registerToolboxDeleteArea,
      syncHistoryState,
      unregisterToolboxDeleteArea,
    ],
  )

  const handleToolboxRootRefChange = useCallback(
    (element: HTMLElement | null) => {
      toolboxRootRef.current = element
      registerToolboxDeleteArea(workspaceRef.current, element)
    },
    [registerToolboxDeleteArea],
  )

  const handleUndo = useCallback(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    workspace.undo(false)
    syncHistoryState(workspace)
  }, [syncHistoryState])

  const handleRedo = useCallback(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    workspace.undo(true)
    syncHistoryState(workspace)
  }, [syncHistoryState])

  const handleZoomIn = useCallback(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    workspace.zoomCenter(1)
  }, [])

  const handleZoomOut = useCallback(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    workspace.zoomCenter(-1)
  }, [])

  const handleZoomToFit = useCallback(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    workspace.zoomToFit()
  }, [])

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleContextMenuItemClick = useCallback((option: any) => {
    setContextMenu(null)

    if (typeof option?.callback !== 'function') {
      return
    }

    window.setTimeout(() => {
      option.callback()
    }, 50)
  }, [])

  const handleBlockPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    item: ToolboxBlockItem,
  ) => {
    // primary button only
    if (e.button !== 0) return

    const workspace = workspaceRef.current
    if (!workspace) return

    if (workspace.options.readOnly) return

    e.preventDefault()

    // close any open tooltip
    workspace.hideChaff()

    // clenup listener
    pendingDragCleanupRef.current?.()
    pendingDragCleanupRef.current = null

    const startX = e.clientX
    const startY = e.clientY
    const pointerId = e.pointerId
    const sourceElement = e.currentTarget

    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerEnd)
      window.removeEventListener('pointercancel', onPointerEnd)

      if (pendingDragCleanupRef.current === cleanup) {
        pendingDragCleanupRef.current = null
      }
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return

      const distance = Math.hypot(
        moveEvent.clientX - startX,
        moveEvent.clientY - startY,
      )

      if (distance < DRAG_THRESHOLD_PX) {
        return
      }

      window.dispatchEvent(new Event('toolboxDragStart'))
      cleanup()
      startSyntheticBlockDrag(moveEvent, sourceElement, item, workspace)
    }

    const onPointerEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return
      // click: no creation
      cleanup()
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerEnd)
    window.addEventListener('pointercancel', onPointerEnd)

    pendingDragCleanupRef.current = cleanup
  }

  return (
    <div className="custom-dragdrop-layout">
      <CustomToolbox
        dataObjects={dataObjects}
        dataLocations={dataLocations}
        dataActions={dataActions}
        isDeleting={isDeleting}
        onRootRefChange={handleToolboxRootRefChange}
        onBlockPointerDown={handleBlockPointerDown}
      />
      <div
        className="custom-dragdrop-workspace-wrapper"
        onContextMenu={(e) => e.preventDefault()}
      >
        <BlocklyComponent
          dataTask={dataTask}
          onWorkspaceReady={handleWorkspaceReady}
        />

        <div className="workspace-controls-overlay" aria-hidden={false}>
          <div className="workspace-controls-group workspace-controls-group--top-right">
            <IconButton
              className="workspace-control-button"
              size="small"
              onClick={handleUndo}
              disabled={!historyState.canUndo}
              aria-label="Undo"
            >
              <Undo2 size={18} />
            </IconButton>

            <IconButton
              className="workspace-control-button"
              size="small"
              onClick={handleRedo}
              disabled={!historyState.canRedo}
              aria-label="Redo"
            >
              <Redo2 size={18} />
            </IconButton>
          </div>

          <div className="workspace-controls-group workspace-controls-group--bottom-right">
            <IconButton
              className="workspace-control-button"
              size="small"
              onClick={handleZoomIn}
              aria-label="Zoom in"
            >
              <Plus size={18} />
            </IconButton>

            <IconButton
              className="workspace-control-button"
              size="small"
              onClick={handleZoomOut}
              aria-label="Zoom out"
            >
              <Minus size={18} />
            </IconButton>

            <IconButton
              className="workspace-control-button"
              size="small"
              onClick={handleZoomToFit}
              aria-label="Fit to screen"
            >
              <Maximize size={18} />
            </IconButton>
          </div>
        </div>

        <Menu
          open={contextMenu !== null}
          onClose={handleCloseContextMenu}
          anchorReference="anchorPosition"
          anchorPosition={
            contextMenu
              ? {
                  top: contextMenu.mouseY,
                  left: contextMenu.mouseX,
                }
              : undefined
          }
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          PaperProps={{
            elevation: 0,
            sx: {
              mt: 0.5,
              p: 0.5,
              minWidth: 220,
              borderRadius: 2,
              border: '1px solid rgba(148, 163, 184, 0.18)',
              boxShadow:
                '0 10px 30px rgba(15, 23, 42, 0.08), 0 3px 8px rgba(15, 23, 42, 0.06)',
            },
          }}
          MenuListProps={{
            dense: true,
            sx: {
              p: 0,
            },
          }}
        >
          {(contextMenu?.options || []).map((option, index) => {
            const label = getMenuOptionText(option.text)
            const { Icon, color } = getMenuIconInfo(label)
            const isDisabled = option.enabled === false

            return (
              <MenuItem
                key={`${label}-${index}`}
                disabled={isDisabled}
                onClick={() => handleContextMenuItemClick(option)}
                sx={{
                  mx: 0.5,
                  my: 0.25,
                  minHeight: 38,
                  borderRadius: 1.5,
                  px: 1,
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 30,
                    color: isDisabled ? 'text.disabled' : color,
                  }}
                >
                  <Icon size={16} strokeWidth={2.1} />
                </ListItemIcon>
                <ListItemText
                  primary={label}
                  primaryTypographyProps={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: isDisabled ? 'text.disabled' : 'text.primary',
                  }}
                />
              </MenuItem>
            )
          })}
        </Menu>
      </div>
    </div>
  )
}
