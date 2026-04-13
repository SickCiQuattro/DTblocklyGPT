import * as Blockly from 'blockly/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from '@mui/material'
import { Maximize, Minus, Plus, Redo2, Undo2 } from 'lucide-react'

import { ActionListType } from 'pages/actions/types'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { AbstractStep, TaskType } from 'pages/tasks/types'
import { blocklyToAbstract, CustomBlock } from 'utils/blocklyParser'
import { BlockState as State } from 'utils/blocklyTypes'

import { CustomToolbox, ToolboxBlockItem } from '../toolbox'
import { BlocklyWorkspace, getBlocklyStructure } from '../workspace'
import '../category/CustomCategory'
import '../styles/editor.css'
import {
  type ContextMenuAction,
  getMenuIconInfo,
  getMenuOptionText,
  installContextMenuBridge,
  type ContextMenuState,
} from './contextMenu'
import { CustomToolboxDeleteArea } from './deleteArea'
import { startSyntheticBlockDrag } from './dragProxy'
import {
  explodeMacro as expandMacroTask,
  getMacroIdFromBlockData,
} from './macroExplosion'

const DRAG_THRESHOLD_PX = 5

/**
 * Props for the shared Blockly editor container.
 */
interface BlocklyEditorProps {
  dataLocations: LocationListType[]
  dataObjects: ObjectListType[]
  dataActions: ActionListType[]
  dataMacros?: TaskType[]
  currentTaskId?: number
  dataTask: State | null
  editMode?: boolean
  applyExternalTaskState?: boolean
  onExternalTaskStateApplied?: () => void
  onTaskStructureChange?: (task: AbstractStep[] | null) => void
}

/**
 * Full Blockly editor: custom toolbox, interactive workspace, controls and context-menu bridge.
 */
export const BlocklyEditor = ({
  dataLocations,
  dataObjects,
  dataActions,
  dataMacros = [],
  currentTaskId,
  dataTask,
  editMode = true,
  applyExternalTaskState = false,
  onExternalTaskStateApplied,
  onTaskStructureChange,
}: BlocklyEditorProps) => {
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null)
  const toolboxRootRef = useRef<HTMLElement | null>(null)
  const deleteAreaRef = useRef<CustomToolboxDeleteArea | null>(null)
  const deleteAreaWorkspaceRef = useRef<Blockly.WorkspaceSvg | null>(null)
  const workspaceChangeListenerRef = useRef<
    ((event: Blockly.Events.Abstract) => void) | null
  >(null)
  const pendingDragCleanupRef = useRef<(() => void) | null>(null)
  const contextMenuOptionIdRef = useRef(0)
  const [isDeleting, setIsDeleting] = useState(false)
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  })
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const availableMacros = useMemo(() => {
    if (currentTaskId === undefined) {
      return dataMacros
    }

    return dataMacros.filter((macro) => macro.id !== currentTaskId)
  }, [currentTaskId, dataMacros])

  const explodeMacro = useCallback(
    (block: Blockly.BlockSvg, workspace: Blockly.WorkspaceSvg) => {
      expandMacroTask({
        block,
        workspace,
        dataMacros: availableMacros,
        dataObjects,
        dataLocations,
        dataActions,
      })
    },
    [availableMacros, dataActions, dataLocations, dataObjects],
  )

  /** Keep floating toolbar undo/redo state in sync with Blockly history stacks. */
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

  /** Remove custom delete-area registration from the active workspace instance. */
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

  /** Register custom delete-area integration for the React toolbox container. */
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

  /** Detach the workspace listener currently tracked in the refs, if any. */
  const detachWorkspaceListener = useCallback(() => {
    const workspace = workspaceRef.current
    const listener = workspaceChangeListenerRef.current

    if (workspace && listener) {
      workspace.removeChangeListener(listener)
    }

    workspaceChangeListenerRef.current = null
  }, [])

  useEffect(() => {
    return installContextMenuBridge({
      workspaceRef,
      setContextMenu,
      getNextOptionId: () => ++contextMenuOptionIdRef.current,
      onExpandMacro: explodeMacro,
      resolveMacroId: getMacroIdFromBlockData,
    })
  }, [explodeMacro])

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

        if (
          `${event.type}` !== `${Blockly.Events.UI}` &&
          onTaskStructureChange
        ) {
          const blocklyTaskStructure = getBlocklyStructure()
          const abstractTask = blocklyToAbstract(
            blocklyTaskStructure as CustomBlock | null,
          )
          onTaskStructureChange(abstractTask)
        }

        if (`${event.type}` !== `${Blockly.Events.BLOCK_DRAG}`) {
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
      onTaskStructureChange,
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

  const handleContextMenuItemClick = useCallback(
    (option: ContextMenuAction) => {
      setContextMenu(null)

      if (typeof option?.callback !== 'function') {
        return
      }

      window.setTimeout(() => {
        option.callback()
      }, 50)
    },
    [],
  )

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

    // cleanup listener
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
        dataMacros={availableMacros}
        isDeleting={isDeleting}
        onRootRefChange={handleToolboxRootRefChange}
        onBlockPointerDown={handleBlockPointerDown}
      />
      <div
        className="custom-dragdrop-workspace-wrapper"
        onContextMenu={(e) => e.preventDefault()}
      >
        <BlocklyWorkspace
          dataTask={dataTask}
          editMode={editMode}
          applyExternalTaskState={applyExternalTaskState}
          onExternalTaskStateApplied={onExternalTaskStateApplied}
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
          slotProps={{
            paper: {
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
            },
            list: {
              dense: true,
              sx: {
                p: 0,
              },
            },
          }}
        >
          {(contextMenu?.options || []).map((option) => {
            const label = getMenuOptionText(option.text)
            const { Icon, color } = getMenuIconInfo(label)
            const isDisabled = option.enabled === false

            return (
              <MenuItem
                key={option.id}
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
                  slotProps={{
                    primary: {
                      sx: {
                        fontSize: 14,
                        fontWeight: 500,
                        color: isDisabled ? 'text.disabled' : 'text.primary',
                      },
                    },
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
