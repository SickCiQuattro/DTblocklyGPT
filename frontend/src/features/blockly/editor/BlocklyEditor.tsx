import * as Blockly from 'blockly/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Divider,
  IconButton,
  InputBase,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material'
import { Maximize, Minus, Plus, Redo2, Search, Undo2 } from 'lucide-react'

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

type ShadowPopoverType = 'object' | 'location' | 'action' | 'trigger'

type SelectableShadowBlockType =
  | 'object_block'
  | 'location_block'
  | 'action_block'
  | 'sensor_signal_block'
  | 'find_object_block'
  | 'touch_detect_block'
  | 'gesture_block'
  | 'timer_block'

type ShadowEntityBlockType =
  | 'object_block'
  | 'location_block'
  | 'action_block'
  | 'shadow_object_block'
  | 'shadow_location_block'
  | 'shadow_action_block'
  | 'shadow_trigger_block'

interface ShadowPickerItem {
  id: number
  name: string
  keywords: string[]
  blockType?: SelectableShadowBlockType
}

interface ShadowPickerPosition {
  top: number
  left: number
}

interface ShadowEntitySource {
  id: number
  name: string
  keywords?: string[] | null
}

const SHADOW_POPOVER_BY_BLOCK_TYPE: Record<
  ShadowEntityBlockType,
  ShadowPopoverType
> = {
  object_block: 'object',
  shadow_object_block: 'object',
  location_block: 'location',
  shadow_location_block: 'location',
  action_block: 'action',
  shadow_action_block: 'action',
  shadow_trigger_block: 'trigger',
}

const SHADOW_PICKER_TITLE_BY_TYPE: Record<ShadowPopoverType, string> = {
  object: 'Select Part',
  location: 'Select Destination',
  action: 'Select Skill',
  trigger: 'Select Trigger',
}

const SHADOW_PICKER_EMPTY_BY_TYPE: Record<ShadowPopoverType, string> = {
  object: 'No parts available.',
  location: 'No destinations available.',
  action: 'No skills available.',
  trigger: 'No triggers available.',
}

const TRIGGER_PICKER_ITEMS: ShadowPickerItem[] = [
  {
    id: 1,
    name: 'External Sensor is ON',
    keywords: ['sensor', 'signal', 'machine', 'external'],
    blockType: 'sensor_signal_block',
  },
  {
    id: 2,
    name: 'Object is Found',
    keywords: ['object', 'vision', 'camera', 'find'],
    blockType: 'find_object_block',
  },
  {
    id: 3,
    name: 'Robot is Touched',
    keywords: ['touch', 'collision', 'contact', 'force'],
    blockType: 'touch_detect_block',
  },
  {
    id: 4,
    name: 'Gesture is Seen',
    keywords: ['gesture', 'camera', 'operator', 'hand'],
    blockType: 'gesture_block',
  },
  {
    id: 5,
    name: 'Seconds have passed',
    keywords: ['timer', 'seconds', 'delay', 'time'],
    blockType: 'timer_block',
  },
]

const resolveShadowPopoverType = (
  blockType: string,
): ShadowPopoverType | null => {
  if (blockType in SHADOW_POPOVER_BY_BLOCK_TYPE) {
    return SHADOW_POPOVER_BY_BLOCK_TYPE[blockType as ShadowEntityBlockType]
  }
  return null
}

const toKeywordsCsvOrNull = (keywords: string[]) => {
  const normalized = keywords
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0)

  return normalized.length > 0 ? normalized.join(',') : null
}

const buildShadowPickerItems = (
  entities: ShadowEntitySource[],
  fallbackPrefix: 'Object' | 'Location' | 'Action',
): ShadowPickerItem[] => {
  return entities.map((entity) => ({
    id: entity.id,
    name: entity.name?.trim() || `${fallbackPrefix} ${entity.id}`,
    keywords: Array.isArray(entity.keywords) ? entity.keywords : [],
  }))
}

const filterShadowItems = (
  items: ShadowPickerItem[],
  query: string,
): ShadowPickerItem[] => {
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) {
    return items
  }

  return items.filter((item) => {
    if (item.name.toLowerCase().includes(normalizedQuery)) {
      return true
    }

    return item.keywords.some((keyword) =>
      keyword.toLowerCase().includes(normalizedQuery),
    )
  })
}

const resolveRealBlockTypeFromShadow = (
  blockType: string,
): SelectableShadowBlockType | null => {
  if (blockType === 'shadow_trigger_block') {
    return 'sensor_signal_block'
  }

  if (blockType.startsWith('shadow_')) {
    const resolvedType = blockType.replace('shadow_', '')
    if (
      resolvedType === 'object_block' ||
      resolvedType === 'location_block' ||
      resolvedType === 'action_block'
    ) {
      return resolvedType
    }
  }

  if (
    blockType === 'object_block' ||
    blockType === 'location_block' ||
    blockType === 'action_block' ||
    blockType === 'sensor_signal_block' ||
    blockType === 'find_object_block' ||
    blockType === 'touch_detect_block' ||
    blockType === 'gesture_block' ||
    blockType === 'timer_block'
  ) {
    return blockType
  }

  return null
}

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
  const [shadowPickerPosition, setShadowPickerPosition] =
    useState<ShadowPickerPosition | null>(null)
  const [popoverType, setPopoverType] = useState<ShadowPopoverType | null>(null)
  const [targetShadowBlockId, setTargetShadowBlockId] = useState<string | null>(
    null,
  )

  // Search query used by the shadow picker menu.
  const [searchQuery, setSearchQuery] = useState('')

  const availableMacros = useMemo(() => {
    if (currentTaskId === undefined) {
      return dataMacros
    }

    return dataMacros.filter((macro) => macro.id !== currentTaskId)
  }, [currentTaskId, dataMacros])

  const selectedShadowItems = useMemo<ShadowPickerItem[]>(() => {
    switch (popoverType) {
      case 'object':
        return buildShadowPickerItems(dataObjects, 'Object')
      case 'location':
        return buildShadowPickerItems(dataLocations, 'Location')
      case 'action':
        return buildShadowPickerItems(dataActions, 'Action')
      case 'trigger':
        return TRIGGER_PICKER_ITEMS
      default:
        return []
    }
  }, [dataActions, dataLocations, dataObjects, popoverType])

  // Filter menu entries by name and keywords while the user types.
  const filteredShadowItems = useMemo(
    () => filterShadowItems(selectedShadowItems, searchQuery),
    [selectedShadowItems, searchQuery],
  )

  // Reset all shadow-picker state together when it closes.
  const closeShadowPicker = useCallback(() => {
    setShadowPickerPosition(null)
    setPopoverType(null)
    setTargetShadowBlockId(null)
    setSearchQuery('')
  }, [])

  const resolveShadowPickerPosition = useCallback(
    (workspace: Blockly.WorkspaceSvg, block: Blockly.Block) => {
      const blockSvg = block as Blockly.BlockSvg
      const svgRoot = blockSvg.getSvgRoot?.()

      if (svgRoot) {
        const rect = svgRoot.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          return {
            top: Math.round(rect.top + rect.height / 2),
            left: Math.round(rect.left + rect.width / 2),
          }
        }
      }

      try {
        const surfacePosition = block.getRelativeToSurfaceXY()
        const blockSize = blockSvg.getHeightWidth()
        const blockCenter = new Blockly.utils.Coordinate(
          surfacePosition.x + blockSize.width / 2,
          surfacePosition.y + blockSize.height / 2,
        )
        const screenCenter = Blockly.utils.svgMath.wsToScreenCoordinates(
          workspace,
          blockCenter,
        )

        return {
          top: Math.round(screenCenter.y),
          left: Math.round(screenCenter.x),
        }
      } catch {
        return {
          top: Math.round(window.innerHeight / 2),
          left: Math.round(window.innerWidth / 2),
        }
      }
    },
    [],
  )

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
      closeShadowPicker()
      setContextMenu(null)
      detachWorkspaceListener()
      unregisterToolboxDeleteArea()
      workspaceRef.current = null
    }
  }, [closeShadowPicker, detachWorkspaceListener, unregisterToolboxDeleteArea])

  const handleSelectShadowItem = useCallback(
    (item: ShadowPickerItem) => {
      const workspace = workspaceRef.current

      if (!workspace || !targetShadowBlockId) {
        closeShadowPicker()
        return
      }

      const shadowBlock = workspace.getBlockById(targetShadowBlockId)
      if (!shadowBlock || !shadowBlock.isShadow()) {
        closeShadowPicker()
        return
      }

      const parentConnection = shadowBlock.outputConnection?.targetConnection
      if (!parentConnection) {
        closeShadowPicker()
        return
      }

      const selectedBlockType =
        item.blockType ?? resolveRealBlockTypeFromShadow(shadowBlock.type)

      if (!selectedBlockType) {
        closeShadowPicker()
        return
      }

      const isEntityBlock =
        selectedBlockType === 'object_block' ||
        selectedBlockType === 'location_block' ||
        selectedBlockType === 'action_block'

      Blockly.Events.setGroup(true)
      try {
        const displayName =
          item.name.trim().length > 0 ? item.name.trim() : `${item.id}`

        const blockState: State = isEntityBlock
          ? {
              type: selectedBlockType,
              fields: { name: displayName },
              data: JSON.stringify({
                id: item.id,
                name: displayName,
                keywords: toKeywordsCsvOrNull(item.keywords),
              }),
            }
          : {
              type: selectedBlockType,
              ...(selectedBlockType === 'find_object_block'
                ? {
                    inputs: {
                      OBJECT: {
                        shadow: {
                          type: 'shadow_object_block',
                          fields: { name: 'Select Part...' },
                        },
                      },
                    },
                  }
                : {}),
            }

        // Let Blockly create and hydrate the block in one pass.
        const newBlock = Blockly.serialization.blocks.append(
          blockState,
          workspace,
        ) as Blockly.BlockSvg

        // Connect the new block to the parent input; the shadow is replaced automatically.
        if (newBlock.outputConnection) {
          parentConnection.connect(newBlock.outputConnection)
        }
      } finally {
        Blockly.Events.setGroup(false)
        closeShadowPicker()
      }
    },
    [closeShadowPicker, targetShadowBlockId],
  )

  const handleWorkspaceReady = useCallback(
    (workspace: Blockly.WorkspaceSvg | null) => {
      detachWorkspaceListener()
      unregisterToolboxDeleteArea()
      workspaceRef.current = workspace

      if (!workspace) {
        setIsDeleting(false)
        closeShadowPicker()
        syncHistoryState(null)
        return
      }

      const listener = (event: Blockly.Events.Abstract) => {
        syncHistoryState(workspace)

        if (`${event.type}` === `${Blockly.Events.CLICK}`) {
          // Open the contextual picker only for supported shadow blocks.
          if (workspace.options.readOnly) {
            closeShadowPicker()
            return
          }

          const clickEvent = event as Blockly.Events.Click & {
            blockId?: string
          }

          if (!clickEvent.blockId) {
            closeShadowPicker()
            return
          }

          const clickedBlock = workspace.getBlockById(clickEvent.blockId)

          if (!clickedBlock || !clickedBlock.isShadow()) {
            closeShadowPicker()
            return
          }

          const nextPopoverType = resolveShadowPopoverType(clickedBlock.type)

          if (!nextPopoverType) {
            closeShadowPicker()
            return
          }

          // Close Blockly floating UI before opening the custom MUI picker.
          workspace.hideChaff()
          setContextMenu(null)
          setShadowPickerPosition(
            resolveShadowPickerPosition(workspace, clickedBlock),
          )
          setPopoverType(nextPopoverType)
          setTargetShadowBlockId(clickedBlock.id)
          return
        }

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
      closeShadowPicker,
      detachWorkspaceListener,
      onTaskStructureChange,
      registerToolboxDeleteArea,
      resolveShadowPickerPosition,
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

  const handleCloseShadowMenu = useCallback(() => {
    closeShadowPicker()
  }, [closeShadowPicker])

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
          open={
            shadowPickerPosition !== null &&
            popoverType !== null &&
            targetShadowBlockId !== null
          }
          onClose={handleCloseShadowMenu}
          autoFocus={false}
          disableAutoFocusItem
          anchorReference="anchorPosition"
          anchorPosition={shadowPickerPosition ?? undefined}
          transformOrigin={{ vertical: 'top', horizontal: 'center' }}
          slotProps={{
            paper: {
              elevation: 0,
              sx: {
                mt: 1,
                minWidth: 280,
                maxWidth: 380,
                borderRadius: '12px',
                border: '1px solid rgba(226, 232, 240, 1)',
                boxShadow:
                  '0 12px 32px -4px rgba(15, 23, 42, 0.12), 0 4px 12px -2px rgba(15, 23, 42, 0.08)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
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
          <Box
            sx={{
              position: 'sticky',
              top: 0,
              backgroundColor: '#fff',
              zIndex: 1,
              px: 1.25,
              pt: 1.25,
              pb: 1,
            }}
          >
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                color: '#0F172A',
                fontSize: '0.85rem',
                mb: 1,
              }}
            >
              {popoverType
                ? SHADOW_PICKER_TITLE_BY_TYPE[popoverType]
                : 'Select'}
            </Typography>

            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: '#FFFFFF',
                borderRadius: '8px',
                border: '1px solid #E2E8F0',
                px: 1,
                py: 0.5,
                transition: 'border-color 0.18s ease, box-shadow 0.18s ease',
                '&:focus-within': {
                  borderColor: '#3B82F6',
                  boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.15)',
                },
              }}
            >
              <Search size={16} color="#64748B" style={{ marginRight: 8 }} />
              <InputBase
                autoFocus
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(event) => {
                  // Prevent MUI MenuList typeahead from hijacking keyboard input.
                  event.stopPropagation()
                }}
                sx={{
                  flex: 1,
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  color: '#1E293B',
                  '& input::placeholder': {
                    color: '#94A3B8',
                    opacity: 1,
                  },
                }}
              />
            </Box>
          </Box>

          <Divider sx={{ mx: 0, borderColor: '#E2E8F0' }} />

          <Box
            sx={{
              maxHeight: 280,
              overflowY: 'auto',
              px: 1,
              py: 0.75,
              '&::-webkit-scrollbar': {
                width: '6px',
              },
              '&::-webkit-scrollbar-track': {
                backgroundColor: '#F8FAFC',
                borderRadius: '10px',
              },
              '&::-webkit-scrollbar-thumb': {
                backgroundColor: '#CBD5E1',
                borderRadius: '10px',
              },
              '&::-webkit-scrollbar-thumb:hover': {
                backgroundColor: '#94A3B8',
              },
            }}
          >
            {filteredShadowItems.length === 0 ? (
              <MenuItem disabled sx={{ borderRadius: 1.5 }}>
                <ListItemText
                  primary={
                    searchQuery
                      ? 'No results found.'
                      : popoverType
                        ? SHADOW_PICKER_EMPTY_BY_TYPE[popoverType]
                        : 'No items.'
                  }
                  slotProps={{
                    primary: {
                      sx: { fontSize: '0.85rem', textAlign: 'center', py: 2 },
                    },
                  }}
                />
              </MenuItem>
            ) : (
              filteredShadowItems.map((item) => {
                const keywords = item.keywords
                  .map((keyword) => keyword.trim())
                  .filter((keyword) => keyword.length > 0)

                return (
                  <MenuItem
                    key={`${popoverType}-${item.id}`}
                    onClick={() => handleSelectShadowItem(item)}
                    sx={{
                      my: 0.2,
                      minHeight: 44,
                      borderRadius: '8px',
                      px: 1.25,
                      alignItems: 'flex-start',
                      transition: 'background-color 0.2s',
                      '&:hover': {
                        backgroundColor: '#F8FAFC',
                      },
                    }}
                  >
                    <ListItemText
                      primary={item.name}
                      secondary={
                        keywords.length > 0
                          ? `Keywords: ${keywords.join(', ')}`
                          : undefined
                      }
                      slotProps={{
                        primary: {
                          sx: {
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            color: '#0F172A',
                          },
                        },
                        secondary: {
                          sx: {
                            mt: 0.2,
                            fontSize: '0.75rem',
                            color: '#64748B',
                          },
                        },
                      }}
                    />
                  </MenuItem>
                )
              })
            )}
          </Box>
        </Menu>

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
