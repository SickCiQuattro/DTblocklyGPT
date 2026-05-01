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

import { blocksColours } from '../blocks'
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

type ShadowPopoverType =
  | 'object'
  | 'location'
  | 'action'
  | 'trigger'
  | 'sequence'

type SelectableShadowBlockType =
  | 'object_block'
  | 'location_block'
  | 'action_block'
  | 'sensor_signal_block'
  | 'find_object_block'
  | 'touch_detect_block'
  | 'gesture_block'
  | 'timer_block'
  | 'logic_and_block'
  | 'logic_or_block'
  | 'logic_not_block'
  // sequence blocks
  | 'pick_block'
  | 'processing_block'
  | 'place_block'
  | 'move_to_block'
  | 'gripper_block'
  | 'wait_block'
  | 'human_action_block'
  | 'notify_action_block'
  | 'repeat_block'
  | 'loop_block'
  | 'repeat_until_block'
  | 'when_block'
  | 'when_otherwise_block'
  | 'macro_task_block'

type ShadowEntityBlockType =
  | 'object_block'
  | 'location_block'
  | 'action_block'
  | 'shadow_object_block'
  | 'shadow_location_block'
  | 'shadow_action_block'
  | 'shadow_trigger_block'
  | 'shadow_sequence_block'

// Block types that can be selected directly from the shadow picker.
const DIRECT_BLOCK_TYPES = new Set<SelectableShadowBlockType>([
  'object_block',
  'location_block',
  'action_block',
  'sensor_signal_block',
  'find_object_block',
  'touch_detect_block',
  'gesture_block',
  'timer_block',
  'logic_and_block',
  'logic_or_block',
  'logic_not_block',
])

// Pure helper: returns blockState fragments for blocks that need shadow inputs.
const getBlockInputState = (
  blockType: SelectableShadowBlockType,
): Record<string, unknown> => {
  const shadowTrigger = {
    shadow: {
      type: 'shadow_trigger_block',
      fields: { name: 'Select Condition' },
    },
  }
  const shadowObject = {
    shadow: {
      type: 'shadow_object_block',
      fields: { name: 'Select Object' },
    },
  }

  switch (blockType) {
    case 'logic_and_block':
    case 'logic_or_block':
      return { inputs: { A: shadowTrigger, B: shadowTrigger } }
    case 'logic_not_block':
      return { inputs: { BOOL: shadowTrigger } }
    case 'find_object_block':
      return { inputs: { OBJECT: shadowObject } }
    default:
      return {}
  }
}

interface ShadowPickerItem {
  id: number
  name: string
  description?: string
  group?: string
  paramHint?: string
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
  group?: string | null
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
  shadow_sequence_block: 'sequence',
}

const SHADOW_PICKER_TITLE_BY_TYPE: Record<ShadowPopoverType, string> = {
  object: 'Select Object',
  location: 'Select Destination',
  action: 'Select Procedure',
  trigger: 'Select Condition',
  sequence: 'Add a step',
}

const SHADOW_PICKER_EMPTY_BY_TYPE: Record<ShadowPopoverType, string> = {
  object: 'No objects available.',
  location: 'No destinations available.',
  action: 'No procedures available.',
  trigger: 'No conditions available.',
  sequence: 'No steps available.',
}

const TRIGGER_PICKER_ITEMS: ShadowPickerItem[] = [
  {
    id: 1,
    name: 'External signal received',
    description: 'A connected machine or button sends a digital signal.',
    group: 'Conditions',
    keywords: ['sensor', 'signal', 'machine', 'external'],
    blockType: 'sensor_signal_block',
  },
  {
    id: 2,
    name: 'Object detected',
    description: 'Camera checks if a specific object is visible.',
    group: 'Conditions',
    paramHint: 'object',
    keywords: ['object', 'vision', 'camera', 'find'],
    blockType: 'find_object_block',
  },
  {
    id: 3,
    name: 'Contact detected',
    description: 'Someone or something is physically touching the robot.',
    group: 'Conditions',
    keywords: ['touch', 'collision', 'contact', 'force'],
    blockType: 'touch_detect_block',
  },
  {
    id: 4,
    name: 'Gesture detected',
    description: 'Worker shows a specific hand gesture to the camera.',
    group: 'Conditions',
    paramHint: 'gesture type',
    keywords: ['gesture', 'camera', 'hand'],
    blockType: 'gesture_block',
  },
  {
    id: 5,
    name: 'Time passed',
    description: 'Becomes true after a set number of seconds.',
    group: 'Conditions',
    paramHint: 'seconds',
    keywords: ['timer', 'seconds', 'delay', 'time'],
    blockType: 'timer_block',
  },
  {
    id: 6,
    name: 'AND',
    description: 'Both conditions must be true at the same time.',
    group: 'Logic',
    paramHint: 'A  +  B',
    keywords: ['and', 'both', 'combine'],
    blockType: 'logic_and_block',
  },
  {
    id: 7,
    name: 'OR',
    description: 'At least one of the two conditions must be true.',
    group: 'Logic',
    paramHint: 'A  or  B',
    keywords: ['or', 'either', 'combine'],
    blockType: 'logic_or_block',
  },
  {
    id: 8,
    name: 'NOT',
    description: 'Reverses the result — true becomes false.',
    group: 'Logic',
    paramHint: 'reverses',
    keywords: ['not', 'negate', 'invert', 'opposite'],
    blockType: 'logic_not_block',
  },
]

const buildSequencePickerItems = (macros: TaskType[]): ShadowPickerItem[] => {
  const staticItems: ShadowPickerItem[] = [
    {
      id: -1,
      name: 'Pick up',
      description: 'Pick up an object with the robot arm',
      keywords: ['pick', 'grab', 'grasp', 'object'],
      blockType: 'pick_block',
      group: 'Robot Actions',
    },
    {
      id: -2,
      name: 'Perform',
      description: 'Execute a pre-configured procedure',
      keywords: ['perform', 'procedure', 'execute', 'skill'],
      blockType: 'processing_block',
      group: 'Robot Actions',
    },
    {
      id: -3,
      name: 'Place at',
      description: 'Place the held object at a destination',
      keywords: ['place', 'put', 'deposit', 'location'],
      blockType: 'place_block',
      group: 'Robot Actions',
    },
    {
      id: -4,
      name: 'Move to',
      description: 'Move the robot to a specific location',
      keywords: ['move', 'go', 'navigate', 'location'],
      blockType: 'move_to_block',
      group: 'Robot Actions',
    },
    {
      id: -5,
      name: 'Gripper',
      description: 'Open or close the robot gripper',
      keywords: ['gripper', 'open', 'close', 'hand'],
      blockType: 'gripper_block',
      group: 'Robot Actions',
    },
    {
      id: -6,
      name: 'Wait',
      description: 'Pause execution for a set amount of time',
      keywords: ['wait', 'pause', 'delay', 'seconds'],
      blockType: 'wait_block',
      group: 'Robot Actions',
    },
    {
      id: -7,
      name: 'Pause and show',
      description: 'Pause and prompt a human operator to act',
      keywords: ['human', 'pause', 'operator', 'show'],
      blockType: 'human_action_block',
      group: 'Human Steps',
    },
    {
      id: -8,
      name: 'Show message',
      description: 'Display a notification and continue',
      keywords: ['notify', 'message', 'info', 'continue'],
      blockType: 'notify_action_block',
      group: 'Human Steps',
    },
    {
      id: -9,
      name: 'Repeat N times',
      description: 'Repeat a sequence a fixed number of times',
      keywords: ['repeat', 'loop', 'times', 'count'],
      blockType: 'repeat_block',
      group: 'Task Flow',
    },
    {
      id: -10,
      name: 'Repeat forever',
      description: 'Repeat a sequence indefinitely',
      keywords: ['loop', 'forever', 'infinite'],
      blockType: 'loop_block',
      group: 'Task Flow',
    },
    {
      id: -11,
      name: 'Repeat until',
      description: 'Repeat until a condition is met',
      keywords: ['repeat', 'until', 'condition', 'while'],
      blockType: 'repeat_until_block',
      group: 'Task Flow',
    },
    {
      id: -12,
      name: 'When',
      description: 'Execute steps only when a condition is true',
      keywords: ['when', 'if', 'condition'],
      blockType: 'when_block',
      group: 'Task Flow',
    },
    {
      id: -13,
      name: 'When / Otherwise',
      description: 'Execute different steps based on a condition',
      keywords: ['when', 'otherwise', 'if', 'else'],
      blockType: 'when_otherwise_block',
      group: 'Task Flow',
    },
  ]

  const macroItems: ShadowPickerItem[] = macros.map((macro) => ({
    id: macro.id,
    name: macro.name?.trim() || `Task ${macro.id}`,
    description: macro.description?.trim() || undefined,
    keywords: ['task', 'macro', macro.name?.toLowerCase() ?? ''],
    blockType: 'macro_task_block',
    group: 'My Tasks',
  }))

  return [...staticItems, ...macroItems]
}

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
  group: string,
): ShadowPickerItem[] => {
  return entities.map((entity) => ({
    id: entity.id,
    name: entity.name?.trim() || `${fallbackPrefix} ${entity.id}`,
    group: entity.group?.trim() || group,
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

  if (DIRECT_BLOCK_TYPES.has(blockType as SelectableShadowBlockType)) {
    return blockType as SelectableShadowBlockType
  }

  return null
}

const getDotColour = (group: string): string => {
  switch (group) {
    case 'Objects':
      return blocksColours.objectsPositions
    case 'Destinations':
      return blocksColours.objectsPositions
    case 'Procedures':
      return blocksColours.objectsPositions
    case 'Conditions':
      return blocksColours.eventsConditions
    case 'Logic':
      return blocksColours.eventsConditions
    case 'Robot Actions':
      return blocksColours.robotActions
    case 'Human Steps':
      return blocksColours.humanActions
    case 'Task Flow':
      return blocksColours.logicControl
    case 'My Tasks':
      return blocksColours.macroTasks
    default:
      return '#94A3B8'
  }
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
        return buildShadowPickerItems(dataObjects, 'Object', 'Objects')
      case 'location':
        return buildShadowPickerItems(dataLocations, 'Location', 'Destinations')
      case 'action':
        return buildShadowPickerItems(dataActions, 'Action', 'Procedures')
      case 'trigger':
        return TRIGGER_PICKER_ITEMS
      case 'sequence':
        return buildSequencePickerItems(availableMacros)
      default:
        return []
    }
  }, [dataActions, dataLocations, dataObjects, popoverType, availableMacros])

  // Filter menu entries by name and keywords while the user types.
  const filteredShadowItems = useMemo(
    () => filterShadowItems(selectedShadowItems, searchQuery),
    [selectedShadowItems, searchQuery],
  )

  const groupedShadowItems = useMemo(
    () =>
      filteredShadowItems.reduce<Record<string, ShadowPickerItem[]>>(
        (acc, item) => {
          const group = item.group ?? 'Other'
          ;(acc[group] ??= []).push(item)
          return acc
        },
        {},
      ),
    [filteredShadowItems],
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

      const isSequence = shadowBlock.type === 'shadow_sequence_block'
      const parentConnection = isSequence
        ? shadowBlock.previousConnection?.targetConnection
        : shadowBlock.outputConnection?.targetConnection

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

      const isMacroBlock = selectedBlockType === 'macro_task_block'

      Blockly.Events.setGroup(true)
      try {
        const displayName =
          item.name.trim().length > 0 ? item.name.trim() : `${item.id}`

        const baseState: State = isMacroBlock
          ? {
              type: 'macro_task_block',
              fields: { name: displayName },
              data: JSON.stringify({
                id: item.id,
                name: displayName,
                keywords: toKeywordsCsvOrNull(item.keywords),
              }),
            }
          : isEntityBlock
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
                ...(DIRECT_BLOCK_TYPES.has(
                  selectedBlockType as SelectableShadowBlockType,
                )
                  ? getBlockInputState(
                      selectedBlockType as SelectableShadowBlockType,
                    )
                  : {}),
              }

        Blockly.Events.disable()
        let newBlock: Blockly.BlockSvg
        try {
          newBlock = Blockly.serialization.blocks.append(
            baseState,
            workspace,
          ) as Blockly.BlockSvg
          newBlock.initSvg()
          newBlock.render()
        } finally {
          Blockly.Events.enable()
        }

        Blockly.Events.fire(new Blockly.Events.BlockCreate(newBlock))

        if (isSequence) {
          if (newBlock.previousConnection) {
            parentConnection.connect(newBlock.previousConnection)
          }
        } else {
          if (newBlock.outputConnection) {
            parentConnection.connect(newBlock.outputConnection)
          }
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

      // Tracks the group id of the current drag operation (set on BLOCK_DRAG isStart).
      let activeDragGroup: string | null = null

      const listener = (event: Blockly.Events.Abstract) => {
        // Drag tracking
        if (`${event.type}` === `${Blockly.Events.BLOCK_DRAG}`) {
          const dragEvent = event as Blockly.Events.Abstract & {
            isStart?: boolean
          }
          if (dragEvent.isStart === true) {
            activeDragGroup = event.group || null
            setIsDeleting(true)
          } else if (dragEvent.isStart === false) {
            setIsDeleting(false)
          }
          syncHistoryState(workspace)
          return
        }

        if (
          activeDragGroup &&
          `${event.type}` === `${Blockly.Events.BLOCK_MOVE}` &&
          !event.group
        ) {
          ;(event as any).group = activeDragGroup
        }

        if (activeDragGroup && event.group && event.group !== activeDragGroup) {
          activeDragGroup = null
        }

        // Click: open shadow picker
        if (`${event.type}` === `${Blockly.Events.CLICK}`) {
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
          workspace.hideChaff()
          setContextMenu(null)
          setShadowPickerPosition(
            resolveShadowPickerPosition(workspace, clickedBlock),
          )
          setPopoverType(nextPopoverType)
          setTargetShadowBlockId(clickedBlock.id)
          return
        }
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

  const handleBlockPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, item: ToolboxBlockItem) => {
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
    },
    [],
  )

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

        <div className="workspace-controls-overlay">
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
          onClose={closeShadowPicker}
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
              Object.entries(groupedShadowItems).map(
                ([group, items], groupIdx) => (
                  <Box key={group}>
                    {groupIdx > 0 && (
                      <Divider sx={{ my: 0.5, borderColor: '#E2E8F0' }} />
                    )}

                    <Typography
                      sx={{
                        px: 1.25,
                        py: 0.5,
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        color: '#94A3B8',
                        textTransform: 'uppercase',
                      }}
                    >
                      {group}
                    </Typography>

                    {items.map((item) => {
                      const keywords = item.keywords
                        .map((keyword) => keyword.trim())
                        .filter((keyword) => keyword.length > 0)

                      return (
                        <MenuItem
                          key={`${popoverType}-${item.id}`}
                          onClick={() => handleSelectShadowItem(item)}
                          sx={{
                            my: 0.15,
                            minHeight: 52,
                            borderRadius: '8px',
                            px: 1.25,
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 1,
                            '&:hover': {
                              backgroundColor: '#F8FAFC',
                            },
                          }}
                        >
                          <Box
                            sx={{
                              mt: '5px',
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              flexShrink: 0,
                              backgroundColor: getDotColour(group),
                              // opacity: group === 'Logic' ? 0.5 : 1,
                            }}
                          />

                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Box
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.75,
                              }}
                            >
                              <Typography
                                sx={{
                                  fontSize: '0.85rem',
                                  fontWeight: 600,
                                  color: '#0F172A',
                                }}
                              >
                                {item.name}
                              </Typography>
                              {item.paramHint && (
                                <Box
                                  sx={{
                                    px: 0.75,
                                    py: 0.1,
                                    borderRadius: '4px',
                                    backgroundColor: '#F1F5F9',
                                    border: '1px solid #E2E8F0',
                                    fontSize: '0.7rem',
                                    fontWeight: 500,
                                    color: '#64748B',
                                    flexShrink: 0,
                                  }}
                                >
                                  {item.paramHint}
                                </Box>
                              )}
                            </Box>

                            {item.description && (
                              <Typography
                                sx={{
                                  mt: 0.2,
                                  fontSize: '0.75rem',
                                  color: '#64748B',
                                  lineHeight: 1.4,
                                }}
                              >
                                {item.description}
                              </Typography>
                            )}

                            {keywords.length > 0 && !item.description && (
                              <Typography
                                sx={{
                                  mt: 0.2,
                                  fontSize: '0.75rem',
                                  color: '#64748B',
                                }}
                              >
                                Keywords: {keywords.join(', ')}
                              </Typography>
                            )}
                          </Box>
                        </MenuItem>
                      )
                    })}
                  </Box>
                ),
              )
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
