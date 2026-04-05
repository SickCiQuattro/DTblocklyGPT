import * as Blockly from 'blockly/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActionListType } from 'pages/actions/types'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { State } from 'blockly/core/serialization/blocks'
import { IconButton } from '@mui/material'
import UndoOutlinedIcon from '@mui/icons-material/UndoOutlined'
import RedoOutlinedIcon from '@mui/icons-material/RedoOutlined'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import CropFreeOutlinedIcon from '@mui/icons-material/CropFreeOutlined'
import BlocklyComponent from './Blockly'

import { CustomToolbox, ToolboxBlockItem } from './CustomToolbox'
import './CustomCategory'
import './CustomDragDropStyle.css'

const DRAG_THRESHOLD_PX = 5

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
      // 1. Spegni la History per nascondere i micro-spostamenti iniziali.
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
        // 2. Riaccendi la History.
        Blockly.Events.enable()
      }

      if (!block) {
        return
      }

      // 3. Registra un singolo evento ufficiale di creazione.
      if (Blockly.Events.isEnabled()) {
        Blockly.Events.fire(new Blockly.Events.BlockCreate(block))
      }

      // 4. Procedi con il Synthetic Event Routing.
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
      console.error('Errore nel proxy della Gesture Blockly:', error)
    }
  }

  useEffect(() => {
    return () => {
      pendingDragCleanupRef.current?.()
      pendingDragCleanupRef.current = null
      setIsDeleting(false)
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

  const handleBlockPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    item: ToolboxBlockItem,
  ) => {
    // Solo clic primario (tasto sinistro)
    if (e.button !== 0) return

    const workspace = workspaceRef.current
    if (!workspace) return

    if (workspace.options.readOnly) return

    // Previene comportamenti di default del browser (selezione testo, drag HTML nativo)
    e.preventDefault()

    // Chiude eventuali menù Blockly aperti
    workspace.hideChaff()

    // Pulisce eventuali listener di un drag precedente incompleto.
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
      // Se arriviamo qui prima della soglia, era un semplice click: nessuna creazione.
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
      <div className="custom-dragdrop-workspace-wrapper">
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
              <UndoOutlinedIcon fontSize="small" />
            </IconButton>

            <IconButton
              className="workspace-control-button"
              size="small"
              onClick={handleRedo}
              disabled={!historyState.canRedo}
              aria-label="Redo"
            >
              <RedoOutlinedIcon fontSize="small" />
            </IconButton>
          </div>

          <div className="workspace-controls-group workspace-controls-group--bottom-right">
            <IconButton
              className="workspace-control-button"
              size="small"
              onClick={handleZoomIn}
              aria-label="Zoom in"
            >
              <AddIcon fontSize="small" />
            </IconButton>

            <IconButton
              className="workspace-control-button"
              size="small"
              onClick={handleZoomOut}
              aria-label="Zoom out"
            >
              <RemoveIcon fontSize="small" />
            </IconButton>

            <IconButton
              className="workspace-control-button"
              size="small"
              onClick={handleZoomToFit}
              aria-label="Fit to screen"
            >
              <CropFreeOutlinedIcon fontSize="small" />
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  )
}
