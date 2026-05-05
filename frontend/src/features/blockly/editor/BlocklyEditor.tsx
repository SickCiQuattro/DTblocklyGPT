import * as Blockly from 'blockly/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import { getOwnBodyDescendants } from 'utils/blocklySelection'
import { CustomToolbox, ToolboxBlockItem } from '../toolbox'
import { BlocklyWorkspace, getBlocklyStructure } from '../workspace'
import '../category/CustomCategory'
import '../styles/editor.css'
import {
  type ContextMenuAction,
  type ContextMenuEntry,
  type ContextMenuSeparator,
  getMenuIconInfo,
  getMenuOptionText,
  installContextMenuBridge,
  type ContextMenuState,
  type RequestInlineTaskConfirmation,
} from './contextMenu'
import { CustomToolboxDeleteArea } from './deleteArea'
import { startSyntheticBlockDrag } from './dragProxy'
import {
  explodeMacro as expandMacroTask,
  getMacroIdFromBlockData,
} from './macroExplosion'
import { SHADOW_ICON_URIS } from '../blocks/definitions'

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

const STRUCTURE_CHANGING_TYPES = new Set(['create', 'delete', 'move', 'change'])

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
  const keydownCleanupRef = useRef<(() => void) | null>(null)
  const onTaskStructureChangeRef = useRef(onTaskStructureChange)
  useEffect(() => {
    onTaskStructureChangeRef.current = onTaskStructureChange
  }, [onTaskStructureChange])
  const targetShadowBlockIdRef = useRef<string | null>(null)
  const lastDragEndTimeRef = useRef<number>(0)
  const lastDragGroupRef = useRef<string>('')

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
  const setTargetShadowBlock = useCallback((id: string | null) => {
    targetShadowBlockIdRef.current = id
    setTargetShadowBlockId(id)
  }, [])

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

  function getShadowPlusImageEl(
    block: Blockly.BlockSvg,
  ): SVGImageElement | null {
    const svgRoot = block.getSvgRoot?.()
    if (!svgRoot) return null
    return svgRoot.querySelector<SVGImageElement>('image') ?? null
  }

  // Reset all shadow-picker state together when it closes.
  const closeShadowPicker = useCallback(() => {
    const id = targetShadowBlockIdRef.current
    if (id && workspaceRef.current) {
      const block = workspaceRef.current.getBlockById(id)
      const blockSvg = block as Blockly.BlockSvg | null
      if (blockSvg) {
        blockSvg.getSvgRoot?.()?.classList.remove('shadow-block--selected')
        const cssClass = blockSvg.getSvgRoot()?.classList
        const type = cssClass?.contains('custom-dashed-shadow-trigger')
          ? 'trigger'
          : cssClass?.contains('custom-dashed-shadow-sequence')
            ? 'sequence'
            : 'workspace'
        getShadowPlusImageEl(blockSvg)?.setAttribute(
          'href',
          SHADOW_ICON_URIS[type].base,
        )
      }
    }
    setShadowPickerPosition(null)
    setPopoverType(null)
    setTargetShadowBlock(null)
    setSearchQuery('')
  }, [setTargetShadowBlock])

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

  const [inlineTaskConfirm, setInlineTaskConfirm] = useState<{
    macroName: string
    onConfirm: () => void
  } | null>(null)

  const handleRequestInlineTaskConfirmation =
    useCallback<RequestInlineTaskConfirmation>((macroName, onConfirm) => {
      setInlineTaskConfirm({ macroName, onConfirm })
    }, [])

  const [confirmDialog, setConfirmDialog] = useState<{
    message: string
    onConfirm: () => void
    onCancel: () => void
  } | null>(null)

  useEffect(() => {
    return installContextMenuBridge({
      workspaceRef,
      setContextMenu,
      getNextOptionId: () => ++contextMenuOptionIdRef.current,
      onExpandMacro: explodeMacro,
      resolveMacroId: getMacroIdFromBlockData,
      requestInlineTaskConfirmation: handleRequestInlineTaskConfirmation,
    })
  }, [explodeMacro, handleRequestInlineTaskConfirmation])

  useEffect(() => {
    return () => {
      pendingDragCleanupRef.current?.()
      keydownCleanupRef.current?.()
      keydownCleanupRef.current = null
      pendingDragCleanupRef.current = null
      setIsDeleting(false)
      closeShadowPicker()
      setContextMenu(null)
      detachWorkspaceListener()
      unregisterToolboxDeleteArea()
      workspaceRef.current = null
    }
  }, [closeShadowPicker, detachWorkspaceListener, unregisterToolboxDeleteArea])

  useEffect(() => {
    const originalConfirm = window.confirm

    window.confirm = (message?: string): boolean => {
      const workspace = workspaceRef.current
      setConfirmDialog({
        message: message ?? 'Are you sure?',
        onConfirm: () => {
          setConfirmDialog(null)
          if (workspace) {
            Blockly.Events.setGroup(true)
            try {
              workspace
                .getAllBlocks(false)
                .filter((b) => !b.isShadow() && !b.getParent())
                .forEach((b) => b.dispose(false))
            } finally {
              Blockly.Events.setGroup(false)
            }
            syncHistoryState(workspace)
          }
        },
        onCancel: () => setConfirmDialog(null),
      })
      return false
    }

    return () => {
      window.confirm = originalConfirm
    }
  }, [syncHistoryState])

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

      const groupId = Blockly.utils.idGenerator.genUid()
      Blockly.Events.setGroup(groupId)
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

        const newBlock = Blockly.serialization.blocks.append(
          baseState,
          workspace,
        ) as Blockly.BlockSvg
        newBlock.initSvg()
        newBlock.render()

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

      // highlight helpers
      function setShadowIconState(block: Blockly.BlockSvg, lit: boolean) {
        const cssClass = block.getSvgRoot()?.classList
        const type = cssClass?.contains('custom-dashed-shadow-trigger')
          ? 'trigger'
          : cssClass?.contains('custom-dashed-shadow-sequence')
            ? 'sequence'
            : 'workspace'
        const uri = lit
          ? SHADOW_ICON_URIS[type].lit
          : SHADOW_ICON_URIS[type].base
        getShadowPlusImageEl(block)?.setAttribute('href', uri)
      }

      function getShadowBlocks(ws: Blockly.WorkspaceSvg): Blockly.BlockSvg[] {
        return ws
          .getAllBlocks(false)
          .filter((b) => b.isShadow()) as Blockly.BlockSvg[]
      }

      function getDescendantIds(block: Blockly.Block): Set<string> {
        const ids = new Set<string>()
        const queue = [...block.getChildren(false)]
        while (queue.length > 0) {
          const child = queue.pop()!
          ids.add(child.id)
          queue.push(...child.getChildren(false))
        }
        return ids
      }

      function highlightCompatibleShadowBlocks(
        ws: Blockly.WorkspaceSvg,
        draggedBlock: Blockly.Block,
        draggedBlockId: string,
      ) {
        const checker = ws.connectionChecker
        const excludedIds = getDescendantIds(draggedBlock)
        excludedIds.add(draggedBlockId)

        getShadowBlocks(ws).forEach((block) => {
          if (excludedIds.has(block.id)) return

          const shadowConn =
            block.outputConnection ?? block.previousConnection ?? null
          if (!shadowConn) return
          const parentConn = shadowConn.targetConnection
          if (!parentConn) return
          const draggedConn =
            draggedBlock.outputConnection ??
            draggedBlock.previousConnection ??
            null
          if (!draggedConn) return

          const compatible = checker.doTypeChecks(draggedConn, parentConn)
          const svgRoot = block.getSvgRoot?.()
          if (!svgRoot) return
          svgRoot.classList.toggle('shadow-block--drag-target', compatible)
          setShadowIconState(block, compatible)
        })
      }

      function clearShadowBlockHighlights(ws: Blockly.WorkspaceSvg) {
        getShadowBlocks(ws).forEach((block) => {
          const svgRoot = block.getSvgRoot?.()
          if (!svgRoot) return
          svgRoot.classList.remove('shadow-block--drag-target')
          svgRoot.classList.remove('shadow-block--drag-incompatible')
          setShadowIconState(block, false)
        })
      }

      const listener = (event: Blockly.Events.Abstract) => {
        // DEBUG: log drag/move events with group and undo-stack info to help troubleshoot drag-related edge cases.
        // if (['drag', 'move'].includes(event.type)) {
        //   const e = event as any
        //   const stack = (workspace as any).undoStack_ as any[]
        //   console.log(
        //     `[NATIVE DRAG] type=${event.type} | g=${event.group?.slice(0, 6)} | isStart=${e.isStart ?? '—'} | stackLen=${stack?.length}`,
        //   )
        // }
        if (`${event.type}` === `${Blockly.Events.BLOCK_DRAG}`) {
          const dragEvent = event as Blockly.Events.Abstract & {
            isStart?: boolean
          }
          if (dragEvent.isStart === true) {
            lastDragGroupRef.current =
              event.group || Blockly.utils.idGenerator.genUid()
            lastDragEndTimeRef.current = 0

            setIsDeleting(true)
            deleteAreaRef.current?.setActiveDragGroup(lastDragGroupRef.current)
            const draggedBlockId = (event as any).blockId as string | undefined
            const draggedBlock = draggedBlockId
              ? workspace.getBlockById(draggedBlockId)
              : null
            if (draggedBlock && draggedBlockId) {
              highlightCompatibleShadowBlocks(
                workspace,
                draggedBlock,
                draggedBlockId,
              )
            }
          } else if (dragEvent.isStart === false) {
            lastDragEndTimeRef.current = Date.now()

            setIsDeleting(false)
            clearShadowBlockHighlights(workspace)
            deleteAreaRef.current?.setActiveDragGroup(null)
          }
        }

        if (
          ['move', 'drag', 'delete', 'create', 'change'].includes(
            `${event.type}`,
          ) &&
          !(event as any).group &&
          lastDragGroupRef.current &&
          lastDragEndTimeRef.current > 0 &&
          Date.now() - lastDragEndTimeRef.current < 300
        ) {
          const undoStack = (workspace as any).undoStack_ as any[]
          if (undoStack && undoStack.length > 0) {
            const top = undoStack[undoStack.length - 1]
            if (!top.group) {
              top.group = lastDragGroupRef.current
            }
          }
        }

        if (`${event.type}` === `${Blockly.Events.BLOCK_DELETE}`) {
          setIsDeleting(false)
          clearShadowBlockHighlights(workspace)
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

          const svgRoot = (clickedBlock as Blockly.BlockSvg).getSvgRoot?.()
          svgRoot?.classList.add('shadow-block--selected')
          setShadowIconState(clickedBlock as Blockly.BlockSvg, true)

          setShadowPickerPosition(
            resolveShadowPickerPosition(workspace, clickedBlock),
          )
          setPopoverType(nextPopoverType)
          setTargetShadowBlock(clickedBlock.id)
          return
        }
        syncHistoryState(workspace)

        if (
          STRUCTURE_CHANGING_TYPES.has(event.type) &&
          onTaskStructureChangeRef.current
        ) {
          const blocklyTaskStructure = getBlocklyStructure()
          const abstractTask = blocklyToAbstract(
            blocklyTaskStructure as CustomBlock | null,
          )
          onTaskStructureChangeRef.current(abstractTask)
        }
      }

      workspace.addChangeListener(listener)
      workspaceChangeListenerRef.current = listener

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return

        const active = document.activeElement
        if (!active) return

        const allInjectionDivs = document.querySelectorAll('.injectionDiv')
        const isInsideAnyWorkspace = Array.from(allInjectionDivs).some(
          (div) => div === active || div.contains(active),
        )
        if (!isInsideAnyWorkspace) return

        const selected = Blockly.common.getSelected?.()
        if (!selected || !(selected instanceof Blockly.BlockSvg)) return
        if (selected.isShadow()) return

        const ownDescendants = getOwnBodyDescendants(selected)
        const totalCount = 1 + ownDescendants.length
        if (totalCount <= 1) return

        e.preventDefault()
        e.stopImmediatePropagation()

        setConfirmDialog({
          message: `Delete ${totalCount} blocks?`,
          onConfirm: () => {
            setConfirmDialog(null)
            Blockly.Events.setGroup(true)
            try {
              selected.dispose(true)
            } finally {
              Blockly.Events.setGroup(false)
            }
            syncHistoryState(workspace)
          },
          onCancel: () => setConfirmDialog(null),
        })
      }

      document.addEventListener('keydown', handleKeyDown, { capture: true })

      keydownCleanupRef.current = () => {
        document.removeEventListener('keydown', handleKeyDown, {
          capture: true,
        })
      }

      syncHistoryState(workspace)
      registerToolboxDeleteArea(workspace, toolboxRootRef.current)
    },
    [
      closeShadowPicker,
      detachWorkspaceListener,
      registerToolboxDeleteArea,
      resolveShadowPickerPosition,
      syncHistoryState,
      unregisterToolboxDeleteArea,
      setTargetShadowBlock,
      setConfirmDialog,
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

    const stack = workspace.getUndoStack()
    if (stack.length === 0) return

    // take the group of the first event to undo, and keep undoing while the events belong to the same group
    const topGroup = stack[stack.length - 1].group

    // Undo first event
    workspace.undo(false)

    // If it had a group, keep undoing until the group changes
    if (topGroup) {
      let remaining = workspace.getUndoStack()
      while (
        remaining.length > 0 &&
        remaining[remaining.length - 1].group === topGroup
      ) {
        workspace.undo(false)
        remaining = workspace.getUndoStack()
      }
    }

    syncHistoryState(workspace)
  }, [syncHistoryState])

  const handleRedo = useCallback(() => {
    const workspace = workspaceRef.current
    if (!workspace) return

    const redoStack = (workspace as any).redoStack_ as Blockly.Events.Abstract[]
    if (!redoStack || redoStack.length === 0) return

    const topGroup = redoStack[redoStack.length - 1].group

    workspace.undo(true)

    if (topGroup) {
      let remaining = (workspace as any).redoStack_ as Blockly.Events.Abstract[]
      while (
        remaining.length > 0 &&
        remaining[remaining.length - 1].group === topGroup
      ) {
        workspace.undo(true)
        remaining = (workspace as any).redoStack_ as Blockly.Events.Abstract[]
      }
    }

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
      const currentMenu = contextMenu
      setContextMenu(null)

      if (typeof option?.callback !== 'function') return

      const label = getMenuOptionText(option.text).toLowerCase()
      const isDelete =
        label.includes('delete') ||
        label.includes('remove') ||
        label.includes('elimina')

      if (isDelete && currentMenu?.blockId) {
        const workspace = workspaceRef.current
        const block = workspace?.getBlockById(currentMenu.blockId)
        if (block instanceof Blockly.BlockSvg && !block.isShadow()) {
          const ownDescendants = getOwnBodyDescendants(block)
          const totalCount = 1 + ownDescendants.length
          if (totalCount > 1) {
            setConfirmDialog({
              message: `Delete ${totalCount} blocks?`,
              onConfirm: () => {
                setConfirmDialog(null)
                window.setTimeout(() => option.callback(), 50)
              },
              onCancel: () => setConfirmDialog(null),
            })
            return
          }
        }
      }

      window.setTimeout(() => option.callback(), 50)
    },
    [contextMenu, setConfirmDialog],
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
                                  fontSize: '1rem',
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
                                  fontSize: '1rem',
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
              ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
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
            list: { dense: true, sx: { p: 0 } },
          }}
        >
          {(contextMenu?.options ?? []).map((entry, idx) => {
            if ('separator' in entry && entry.separator) {
              return (
                <Divider
                  key={`sep-${idx}`}
                  sx={{
                    my: 0.5,
                    mx: 0.5,
                    borderColor: 'rgba(148,163,184,0.18)',
                  }}
                />
              )
            }

            const option = entry as ContextMenuAction
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
        {/* confirmation modal "Inline Task"*/}
        {inlineTaskConfirm && (
          <Dialog
            open
            onClose={() => setInlineTaskConfirm(null)}
            slotProps={{
              paper: {
                elevation: 0,
                sx: {
                  borderRadius: '12px',
                  border: '1px solid #E2E8F0',
                  boxShadow:
                    '0 12px 32px -4px rgba(15, 23, 42, 0.12), 0 4px 12px -2px rgba(15, 23, 42, 0.08)',
                  p: 1.5,
                  maxWidth: 400,
                },
              },
            }}
          >
            <DialogTitle
              sx={{
                fontWeight: 600,
                fontSize: '1.3rem',
                color: '#0F172A',
                pb: 1,
              }}
            >
              Inline Task
            </DialogTitle>
            <DialogContent>
              <Typography
                variant="body2"
                sx={{ color: '#475569', lineHeight: 1.5 }}
              >
                This will replace the{' '}
                <strong style={{ color: '#0F172A' }}>
                  {inlineTaskConfirm.macroName}
                </strong>{' '}
                block with its individual steps.
              </Typography>

              <Box
                sx={{
                  mt: 1.5,
                  p: 1,
                  backgroundColor: '#FFF7ED',
                  borderRadius: '6px',
                  border: '1px solid #FFEDD5',
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    color: '#C2410C',
                    lineHeight: 1.4,
                    fontSize: '0.8rem',
                    fontWeight: 500,
                  }}
                >
                  Note: You can undo this right away, but making changes to the
                  expanded blocks will prevent you from easily reverting to the
                  single block.
                </Typography>
              </Box>
            </DialogContent>
            <DialogActions sx={{ px: 2, pb: 1.5, pt: 1, gap: 1 }}>
              <Button
                variant="text"
                disableElevation
                onClick={() => setInlineTaskConfirm(null)}
                sx={{
                  textTransform: 'none',
                  color: '#64748B',
                  fontWeight: 600,
                  borderRadius: '8px',
                  px: 2,
                  '&:hover': {
                    backgroundColor: '#F1F5F9',
                    color: '#0F172A',
                  },
                }}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                disableElevation
                onClick={() => {
                  inlineTaskConfirm.onConfirm()
                  setInlineTaskConfirm(null)
                }}
                sx={{
                  textTransform: 'none',
                  backgroundColor: '#E15930',
                  color: '#FFFFFF',
                  fontWeight: 600,
                  borderRadius: '8px',
                  px: 2,
                  '&:hover': {
                    backgroundColor: '#C84D28',
                  },
                }}
              >
                Inline Task
              </Button>
            </DialogActions>
          </Dialog>
        )}

        {/* confirmation modal "Delete / Confirm" */}
        {confirmDialog && (
          <Dialog
            open
            onClose={confirmDialog.onCancel}
            slotProps={{
              paper: {
                elevation: 0,
                sx: {
                  borderRadius: '12px',
                  border: '1px solid #E2E8F0',
                  boxShadow:
                    '0 12px 32px -4px rgba(15, 23, 42, 0.12), 0 4px 12px -2px rgba(15, 23, 42, 0.08)',
                  p: 1.5,
                  maxWidth: 400,
                },
              },
            }}
          >
            <DialogTitle
              sx={{
                fontWeight: 600,
                fontSize: '1.3rem',
                color: '#0F172A',
                pb: 1,
              }}
            >
              Confirm
            </DialogTitle>
            <DialogContent>
              <Typography
                variant="body2"
                sx={{ color: '#475569', lineHeight: 1.5 }}
              >
                {confirmDialog.message}
              </Typography>
            </DialogContent>
            <DialogActions sx={{ px: 2, pb: 1.5, pt: 1, gap: 1 }}>
              <Button
                variant="text"
                disableElevation
                onClick={confirmDialog.onCancel}
                sx={{
                  textTransform: 'none',
                  color: '#64748B',
                  fontWeight: 600,
                  borderRadius: '8px',
                  px: 2,
                  '&:hover': {
                    backgroundColor: '#F1F5F9',
                    color: '#0F172A',
                  },
                }}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                disableElevation
                onClick={confirmDialog.onConfirm}
                sx={{
                  textTransform: 'none',
                  backgroundColor: '#E15930',
                  color: '#FFFFFF',
                  fontWeight: 600,
                  borderRadius: '8px',
                  px: 2,
                  '&:hover': {
                    backgroundColor: '#C84D28',
                  },
                }}
              >
                Delete
              </Button>
            </DialogActions>
          </Dialog>
        )}
      </div>
    </div>
  )
}
