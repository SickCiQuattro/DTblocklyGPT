/**
 * BlocklyEditor.tsx
 *
 * Top-level editor component that wires together:
 *  - Custom React toolbox (CustomToolbox)
 *  - Interactive Blockly workspace (BlocklyWorkspace)
 *  - Shadow-block picker popover (useShadowPicker + ShadowPickerMenu)
 *  - Context-menu bridge (installContextMenuBridge)
 *  - Workspace controls overlay (zoom, undo/redo)
 *  - Confirmation dialogs (ConfirmDeleteDialog, InlineTaskDialog)
 *
 * Complex sub-systems (shadow picker catalog, dialog presentation) live in
 * dedicated modules under editor/shadowPicker/ and editor/dialogs/.
 * This file is responsible only for wiring them together and managing the
 * Blockly workspace lifecycle.
 */

import * as Blockly from 'blockly/core'
import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import {
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Popover,
  ToggleButton,
  ToggleButtonGroup,
  Switch,
  Box,
  Stack,
  Typography,
  Button,
} from '@mui/material'
import { Maximize, Minus, Plus, Redo2, Undo2, Settings } from 'lucide-react'

import {
  AbstractStep,
  TaskDetailType,
  TaskType,
  isPublished,
} from 'pages/tasks/types'
import { ActionListType } from 'pages/actions/types'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { blocklyToAbstractAll, CustomBlock } from 'utils/blocklyParser'
import { BlockState as State } from 'utils/blocklyTypes'
import { countRealBlocks, getOwnBodyDescendants } from 'utils/blocklySelection'

import { CustomToolbox, ToolboxBlockItem } from '../toolbox'
import {
  type BlockViewMode,
  type DeleteConfirmMode,
  type ViewSettings,
} from '../utils/useViewSettings'
import { applyBlockViewMode } from '../utils/viewModePresentation'
import { BlocklyWorkspace, getBlocklyStructure } from '../workspace'
import '../category/CustomCategory'
// Side-effect import: registers all Blockly block types (when_start, repeat_block, etc.)
// before any workspace is injected. Must come before BlocklyWorkspace is mounted.
import '../blocks/definitions'
import '../styles/editor.css'

import {
  type ContextMenuAction,
  type ContextMenuState,
  type RequestInlineTaskConfirmation,
  getMenuIconInfo,
  getMenuOptionText,
  installContextMenuBridge,
} from './contextMenu'
import { CustomToolboxDeleteArea, type DeleteZoneState } from './deleteArea'
import { startSyntheticBlockDrag } from './dragProxy'
import {
  explodeMacro as expandMacroTask,
  getMacroIdFromBlockData,
} from './macroExplosion'
import { ConfirmDeleteDialog, InlineTaskDialog } from './dialogs'
import {
  ShadowPickerMenu,
  useShadowPicker,
  setShadowIconState,
  resolveShadowPopoverType,
} from './shadowPicker'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

/** Block type identifier for the mandatory program entry-point block. */
const START_BLOCK_TYPE = 'when_start' as const
const SHADOW_START_BLOCK_TYPE = 'shadow_start_sequence_block' as const

/** Minimum pointer movement (px) before a toolbox pill triggers a block drag. */
const DRAG_THRESHOLD_PX = 5

/**
 * Event types that indicate a structural change to the workspace block tree.
 * Used to decide when to re-serialise the program and fire onTaskStructureChange.
 */
const STRUCTURE_CHANGING_TYPES = new Set<string>([
  Blockly.Events.BLOCK_CREATE,
  Blockly.Events.BLOCK_DELETE,
  Blockly.Events.BLOCK_MOVE,
  Blockly.Events.BLOCK_CHANGE,
])

/**
 * Event types that require re-evaluating which blocks are orphans
 * (disconnected from the when_start chain).
 */
const ORPHAN_SYNC_TYPES = new Set<string>([
  Blockly.Events.BLOCK_CREATE,
  Blockly.Events.BLOCK_DELETE,
  Blockly.Events.BLOCK_MOVE,
  Blockly.Events.BLOCK_CHANGE,
])

// ─── START BLOCK HELPERS ──────────────────────────────────────────────────────

/**
 * Find the single when_start entry-point block in the workspace.
 * Returns null if it has not been inserted yet.
 */
function findStartBlock(
  workspace: Blockly.WorkspaceSvg,
): Blockly.BlockSvg | null {
  return (
    (workspace.getBlocksByType(
      START_BLOCK_TYPE,
      false,
    )[0] as Blockly.BlockSvg) ?? null
  )
}

/**
 * Create the when_start entry-point block at the top-left of the workspace,
 * mark it non-deletable and non-movable, and attach a shadow_start_sequence_block
 * to its next connection slot.
 *
 * @returns The inserted block, or null if the block type is not yet registered.
 */
function insertStartBlock(
  workspace: Blockly.WorkspaceSvg,
): Blockly.BlockSvg | null {
  if (!Blockly.Blocks[START_BLOCK_TYPE]) {
    console.warn(
      `insertStartBlock: Block type ${START_BLOCK_TYPE} not registered yet.`,
    )
    return null
  }
  const block = Blockly.serialization.blocks.append(
    { type: START_BLOCK_TYPE },
    workspace,
  ) as Blockly.BlockSvg
  block.initSvg()
  block.render()
  block.setDeletable(false)
  block.setMovable(false)
  block.moveBy(24, 24)

  if (block.nextConnection) {
    const shadow = workspace.newBlock('shadow_start_sequence_block')
    shadow.setShadow(true)
    shadow.initSvg()
    shadow.render()
    block.nextConnection.connect(shadow.previousConnection)
  }
  return block
}

/**
 * Ensure the when_start block is present in the workspace.
 * If it is missing (e.g. after undo or workspace clear), insert it silently
 * without recording an undo event.
 */
function ensureStartBlock(workspace: Blockly.WorkspaceSvg): void {
  if (findStartBlock(workspace)) return
  Blockly.Events.disable()
  try {
    const inserted = insertStartBlock(workspace)
    if (!inserted)
      console.warn('[ensureStartBlock] when_start not yet registered')
  } finally {
    Blockly.Events.enable()
  }
}

function removeStartBlock(workspace: Blockly.WorkspaceSvg): void {
  const startBlocks = workspace.getBlocksByType(
    START_BLOCK_TYPE,
    false,
  ) as Blockly.BlockSvg[]

  Blockly.Events.disable()
  try {
    for (const startBlock of startBlocks) {
      const target = startBlock.nextConnection?.targetBlock()
      if (target) {
        startBlock.nextConnection?.disconnect()
        if (target.type === SHADOW_START_BLOCK_TYPE) {
          if (target.nextConnection?.targetBlock()) {
            target.nextConnection.disconnect()
          }
          if (!target.disposed) {
            target.dispose(false)
          }
        }
      }
      if (!startBlock.disposed) {
        startBlock.dispose(false)
      }
    }

    const detachedStartShadows = workspace
      .getBlocksByType(SHADOW_START_BLOCK_TYPE, false)
      .filter((block) => !block.getParent()) as Blockly.BlockSvg[]

    for (const shadow of detachedStartShadows) {
      if (shadow.nextConnection?.targetBlock()) {
        shadow.nextConnection.disconnect()
      }
      if (!shadow.disposed) {
        shadow.dispose(false)
      }
    }
  } finally {
    Blockly.Events.enable()
  }
}

function clearOrphanState(workspace: Blockly.WorkspaceSvg): void {
  for (const block of workspace.getAllBlocks(false)) {
    if (block.isShadow()) continue
    if (block.isInsertionMarker()) continue
    block.getSvgRoot?.()?.classList.remove('blockly-orphan')
  }
}

function normalizeVisibleStartBlock(workspace: Blockly.WorkspaceSvg): void {
  const startBlocks = workspace.getBlocksByType(
    START_BLOCK_TYPE,
    false,
  ) as Blockly.BlockSvg[]
  if (startBlocks.length === 0) return

  Blockly.Events.disable()
  try {
    const [primaryStart, ...extraStarts] = startBlocks
    primaryStart.setDeletable(false)
    primaryStart.setMovable(false)

    for (const extraStart of extraStarts) {
      if (extraStart.nextConnection?.targetBlock()) {
        extraStart.nextConnection.disconnect()
      }
      if (!extraStart.disposed) {
        extraStart.dispose(false)
      }
    }

    const detachedStartShadows = workspace
      .getBlocksByType(SHADOW_START_BLOCK_TYPE, false)
      .filter((block) => !block.getParent()) as Blockly.BlockSvg[]
    for (const shadow of detachedStartShadows) {
      if (shadow.nextConnection?.targetBlock()) {
        shadow.nextConnection.disconnect()
      }
      if (!shadow.disposed) {
        shadow.dispose(false)
      }
    }

    const startTarget = primaryStart.nextConnection?.targetBlock()
    if (startTarget?.type !== SHADOW_START_BLOCK_TYPE) return

    const chainedBlock = startTarget.nextConnection?.targetBlock()
    if (chainedBlock?.previousConnection) {
      startTarget.nextConnection?.disconnect()
      primaryStart.nextConnection?.disconnect()
      if (!startTarget.disposed) {
        startTarget.dispose(false)
      }
      primaryStart.nextConnection?.connect(chainedBlock.previousConnection)
      return
    }

    const candidate = workspace
      .getTopBlocks(true)
      .find(
        (block) =>
          !block.disposed &&
          !block.isShadow() &&
          !block.isInsertionMarker() &&
          !block.getParent() &&
          block.type !== START_BLOCK_TYPE &&
          block.type !== SHADOW_START_BLOCK_TYPE &&
          Boolean(block.previousConnection),
      )

    if (!candidate?.previousConnection) return

    primaryStart.nextConnection?.disconnect()
    if (!startTarget.disposed) {
      startTarget.dispose(false)
    }
    primaryStart.nextConnection?.connect(candidate.previousConnection)
  } finally {
    Blockly.Events.enable()
  }
}

function syncStartBlockVisibility(
  workspace: Blockly.WorkspaceSvg,
  showStartBlock: boolean,
): void {
  if (showStartBlock) {
    ensureStartBlock(workspace)
    normalizeVisibleStartBlock(workspace)
  } else {
    removeStartBlock(workspace)
  }
}

// ─── ORPHAN SYNC ──────────────────────────────────────────────────────────────

/**
 * Walk the connected block tree starting from when_start and toggle the
 * CSS class `blockly-orphan` on every non-shadow, non-insertion-marker block
 * that is not reachable from the start block.
 *
 * Orphan blocks are visually de-emphasised to communicate that they will
 * not be part of the executed program.
 */
function syncOrphanState(workspace: Blockly.WorkspaceSvg): void {
  const startBlock = findStartBlock(workspace)
  const startId = startBlock?.id
  const connectedIds = new Set<string>()

  if (startBlock) {
    const queue: Blockly.Block[] = [startBlock]
    while (queue.length > 0) {
      const b = queue.pop()!
      connectedIds.add(b.id)
      const next = b.getNextBlock()
      if (next) queue.push(next)
      for (const input of b.inputList) {
        const target = input.connection?.targetBlock()
        if (target) queue.push(target)
      }
    }
  }

  for (const block of workspace.getAllBlocks(false)) {
    if (block.id === startId) continue
    if (block.isShadow()) continue
    if (block.isInsertionMarker()) continue
    const isConnected = connectedIds.has(block.id)
    block.getSvgRoot?.()?.classList.toggle('blockly-orphan', !isConnected)
  }
}

// ─── REDO STACK COMPAT ────────────────────────────────────────────────────────

/**
 * Retrieve the redo stack from a workspace, working around API differences
 * between Blockly versions (public getRedoStack vs private redoStack_).
 */
const getRedoStack = (
  workspace: Blockly.WorkspaceSvg,
): Blockly.Events.Abstract[] =>
  workspace.getRedoStack?.() ??
  ((workspace as any).redoStack_ as Blockly.Events.Abstract[] | undefined) ??
  ((workspace as any).redoStack as Blockly.Events.Abstract[] | undefined) ??
  []

// ─── PROPS ────────────────────────────────────────────────────────────────────

/** Props for the shared Blockly editor container. */
interface BlocklyEditorProps {
  dataLocations: LocationListType[]
  dataObjects: ObjectListType[]
  dataActions: ActionListType[]
  dataMacros?: TaskType[]
  macroDetailsById?: Record<number, TaskDetailType>
  currentTaskId?: number
  dataTask: State | State[] | null
  pendingExternalTask?: State | null
  editMode?: boolean
  applyExternalTaskState?: boolean
  onExternalTaskStateApplied?: () => void
  onTaskStructureChange?: (
    task: import('pages/tasks/types').ASTBranch[] | null,
  ) => void
  onWorkspaceReady?: (workspace: Blockly.WorkspaceSvg | null) => void
  blockViewMode?: BlockViewMode
  deleteConfirmMode?: DeleteConfirmMode
  showStartBlock?: boolean
  viewSettings?: ViewSettings
  onViewSettingsChange?: (patch: Partial<ViewSettings>) => void
  onResetViewSettings?: () => void
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

/**
 * Full Blockly editor: custom toolbox, interactive workspace, controls, and
 * context-menu bridge.
 *
 * Sub-systems are delegated to dedicated hooks/components:
 *  - Shadow picker → useShadowPicker + ShadowPickerMenu
 *  - Dialogs       → ConfirmDeleteDialog + InlineTaskDialog
 *  - Context menu  → installContextMenuBridge (contextMenu.ts)
 */
export const BlocklyEditor = ({
  dataLocations,
  dataObjects,
  dataActions,
  dataMacros = [],
  macroDetailsById = {},
  currentTaskId,
  dataTask,
  pendingExternalTask,
  editMode = true,
  applyExternalTaskState = false,
  onExternalTaskStateApplied,
  onTaskStructureChange,
  onWorkspaceReady,
  blockViewMode = 'complete',
  deleteConfirmMode = 'multiple',
  showStartBlock = true,
  viewSettings,
  onViewSettingsChange,
  onResetViewSettings,
}: BlocklyEditorProps) => {
  // ── Workspace refs ─────────────────────────────────────────────────────────
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null)
  const toolboxRootRef = useRef<HTMLElement | null>(null)
  const deleteAreaRef = useRef<CustomToolboxDeleteArea | null>(null)
  const deleteAreaWorkspaceRef = useRef<Blockly.WorkspaceSvg | null>(null)
  const workspaceChangeListenerRef = useRef<
    ((e: Blockly.Events.Abstract) => void) | null
  >(null)
  const pendingDragCleanupRef = useRef<(() => void) | null>(null)
  const suppressDeleteZoneForNextDragRef = useRef(false)
  const toolboxHoverTrackingCleanupRef = useRef<(() => void) | null>(null)
  const contextMenuOptionIdRef = useRef(0)
  const keydownCleanupRef = useRef<(() => void) | null>(null)
  const onTaskStructureChangeRef = useRef(onTaskStructureChange)
  useEffect(() => {
    onTaskStructureChangeRef.current = onTaskStructureChange
  }, [onTaskStructureChange])
  const blockViewModeRef = useRef(blockViewMode)
  useEffect(() => {
    blockViewModeRef.current = blockViewMode
  }, [blockViewMode])
  const showStartBlockRef = useRef(showStartBlock)
  useEffect(() => {
    showStartBlockRef.current = showStartBlock
  }, [showStartBlock])
  const lastDragEndTimeRef = useRef<number>(0)
  const lastDragGroupRef = useRef<string>('')
  const taskLoadedRef = useRef(false)

  // ── UI state ───────────────────────────────────────────────────────────────
  const [isDeleting, setIsDeleting] = useState(false)
  const [settingsAnchorEl, setSettingsAnchorEl] =
    useState<HTMLButtonElement | null>(null)
  const handleOpenSettings = (event: React.MouseEvent<HTMLButtonElement>) => {
    setSettingsAnchorEl(event.currentTarget)
  }
  const handleCloseSettings = () => {
    setSettingsAnchorEl(null)
  }
  const isSettingsOpen = Boolean(settingsAnchorEl)
  const [toolboxDeleteZoneState, setToolboxDeleteZoneState] =
    useState<DeleteZoneState>('idle')
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  })
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [inlineTaskConfirm, setInlineTaskConfirm] = useState<{
    macroName: string
    onConfirm: () => void
  } | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string
    onConfirm: () => void
    onCancel: () => void
  } | null>(null)

  // ── Exclude current task from macro list ───────────────────────────────────
  const availableMacros = useMemo(() => {
    const publishedMacros = dataMacros.filter(isPublished)
    return currentTaskId === undefined
      ? publishedMacros
      : publishedMacros.filter((m) => m.id !== currentTaskId)
  }, [currentTaskId, dataMacros])

  // ── Shadow picker ──────────────────────────────────────────────────────────
  const shadowPicker = useShadowPicker({
    workspaceRef,
    dataObjects,
    dataLocations,
    dataActions,
    availableMacros,
  })

  // ── History sync ───────────────────────────────────────────────────────────
  const syncHistoryState = useCallback(
    (workspace: Blockly.WorkspaceSvg | null) => {
      if (!workspace) {
        setHistoryState({ canUndo: false, canRedo: false })
        return
      }
      setHistoryState({
        canUndo: workspace.getUndoStack().length > 0,
        canRedo: getRedoStack(workspace).length > 0,
      })
    },
    [],
  )

  const shouldConfirmDelete = useCallback(
    (count: number) => {
      if (deleteConfirmMode === 'never') return false
      if (deleteConfirmMode === 'always') return count >= 1
      return count > 1
    },
    [deleteConfirmMode],
  )
  const shouldConfirmDeleteRef = useRef(shouldConfirmDelete)
  useEffect(() => {
    shouldConfirmDeleteRef.current = shouldConfirmDelete
  }, [shouldConfirmDelete])

  const syncWorkspacePresentation = useCallback(
    (workspace: Blockly.WorkspaceSvg) => {
      applyBlockViewMode(workspace, blockViewModeRef.current)
      if (showStartBlockRef.current) {
        syncOrphanState(workspace)
      } else {
        clearOrphanState(workspace)
      }
    },
    [],
  )

  const executeDeleteAll = useCallback(
    (workspace: Blockly.WorkspaceSvg) => {
      Blockly.Events.setGroup(true)
      try {
        const startBlock = findStartBlock(workspace)
        if (startBlock?.nextConnection?.targetBlock()) {
          startBlock.nextConnection.disconnect()
        }

        const toDispose = workspace
          .getAllBlocks(false)
          .filter(
            (b) =>
              !b.isShadow() &&
              !b.isInsertionMarker() &&
              b.type !== START_BLOCK_TYPE &&
              !b.getParent(),
          )

        for (let i = toDispose.length - 1; i >= 0; i--) {
          if (!toDispose[i].disposed) toDispose[i].dispose(false)
        }
      } finally {
        Blockly.Events.setGroup(false)
      }

      syncWorkspacePresentation(workspace)
      syncHistoryState(workspace)
    },
    [syncHistoryState, syncWorkspacePresentation],
  )

  // ── Delete area registration ───────────────────────────────────────────────
  const unregisterToolboxDeleteArea = useCallback(() => {
    const ws = deleteAreaWorkspaceRef.current
    const da = deleteAreaRef.current
    if (!ws || !da) return
    try {
      ws.getComponentManager().removeComponent(da.id)
      ws.recordDragTargets()
    } catch {
      /* component already unmounted or workspace not registered */
    }
    toolboxRootRef.current?.classList.remove('custom-toolbox--delete-over')
    deleteAreaRef.current = null
    deleteAreaWorkspaceRef.current = null
  }, [])

  const stopToolboxHoverTracking = useCallback(() => {
    toolboxHoverTrackingCleanupRef.current?.()
    toolboxHoverTrackingCleanupRef.current = null
  }, [])

  const startToolboxHoverTracking = useCallback(() => {
    stopToolboxHoverTracking()

    const onPointerMove = (event: PointerEvent) => {
      const toolboxRect = toolboxRootRef.current?.getBoundingClientRect()
      const isOverToolbox = Boolean(
        toolboxRect &&
        event.clientX >= toolboxRect.left &&
        event.clientX <= toolboxRect.right &&
        event.clientY >= toolboxRect.top &&
        event.clientY <= toolboxRect.bottom,
      )
      setToolboxDeleteZoneState(isOverToolbox ? 'hover-confirm' : 'drag-intent')
    }

    window.addEventListener('pointermove', onPointerMove, true)
    toolboxHoverTrackingCleanupRef.current = () => {
      window.removeEventListener('pointermove', onPointerMove, true)
    }
  }, [stopToolboxHoverTracking])

  const registerToolboxDeleteArea = useCallback(
    (
      workspace: Blockly.WorkspaceSvg | null,
      toolboxElement: HTMLElement | null,
    ) => {
      unregisterToolboxDeleteArea()
      if (!workspace || !toolboxElement || workspace.options.readOnly) return
      const da = new CustomToolboxDeleteArea(toolboxElement)
      workspace.getComponentManager().addComponent(
        {
          component: da,
          capabilities: [
            Blockly.ComponentManager.Capability.DRAG_TARGET,
            Blockly.ComponentManager.Capability.DELETE_AREA,
          ],
          weight: Blockly.ComponentManager.ComponentWeight.TOOLBOX_WEIGHT,
        },
        true,
      )
      workspace.recordDragTargets()
      deleteAreaRef.current = da
      deleteAreaWorkspaceRef.current = workspace
    },
    [unregisterToolboxDeleteArea],
  )

  const detachWorkspaceListener = useCallback(() => {
    const ws = workspaceRef.current
    const listener = workspaceChangeListenerRef.current
    if (ws && listener) ws.removeChangeListener(listener)
    workspaceChangeListenerRef.current = null
  }, [])

  // ── Context menu inline-task confirmation ──────────────────────────────────
  const handleRequestInlineTaskConfirmation =
    useCallback<RequestInlineTaskConfirmation>(
      (macroName, onConfirm) => {
        if (deleteConfirmMode === 'never') {
          onConfirm()
          return
        }
        setInlineTaskConfirm({ macroName, onConfirm })
      },
      [deleteConfirmMode],
    )

  // ── Macro explosion ────────────────────────────────────────────────────────
  const explodeMacro = useCallback(
    (block: Blockly.BlockSvg, workspace: Blockly.WorkspaceSvg) => {
      expandMacroTask({
        block,
        workspace,
        dataMacros: availableMacros,
        macroDetailsById,
        dataObjects,
        dataLocations,
        dataActions,
      })
    },
    [
      availableMacros,
      macroDetailsById,
      dataObjects,
      dataLocations,
      dataActions,
    ],
  )

  // ── Context menu bridge ────────────────────────────────────────────────────
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

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      pendingDragCleanupRef.current?.()
      keydownCleanupRef.current?.()
      keydownCleanupRef.current = null
      pendingDragCleanupRef.current = null
      suppressDeleteZoneForNextDragRef.current = false
      setIsDeleting(false)
      setToolboxDeleteZoneState('idle')
      shadowPicker.close()
      setContextMenu(null)
      stopToolboxHoverTracking()
      detachWorkspaceListener()
      unregisterToolboxDeleteArea()
      workspaceRef.current = null
    }
  }, [])

  // ── window.confirm monkey-patch for "Delete All" ──────────────────────────
  // Blockly's built-in "Delete All Blocks" fires window.confirm. We intercept
  // it to show our own React modal instead of the browser's native dialog.
  useEffect(() => {
    const originalConfirm = window.confirm

    window.confirm = (_message?: string): boolean => {
      const workspace = workspaceRef.current
      const realCount = workspace
        ? countRealBlocks(workspace.getAllBlocks(false), START_BLOCK_TYPE)
        : 0

      if (!workspace) return false

      if (!shouldConfirmDelete(realCount)) {
        executeDeleteAll(workspace)
        return false
      }

      setConfirmDialog({
        message: `Delete all ${realCount} block${realCount !== 1 ? 's' : ''}?`,
        onConfirm: () => {
          setConfirmDialog(null)
          executeDeleteAll(workspace)
        },
        onCancel: () => setConfirmDialog(null),
      })
      return false
    }

    return () => {
      window.confirm = originalConfirm
    }
  }, [executeDeleteAll, shouldConfirmDelete])

  // ── Shadow picker position resolver ───────────────────────────────────────
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
        const pos = block.getRelativeToSurfaceXY()
        const size = blockSvg.getHeightWidth()
        const center = new Blockly.utils.Coordinate(
          pos.x + size.width / 2,
          pos.y + size.height / 2,
        )
        const screen = Blockly.utils.svgMath.wsToScreenCoordinates(
          workspace,
          center,
        )
        return { top: Math.round(screen.y), left: Math.round(screen.x) }
      } catch {
        return {
          top: Math.round(window.innerHeight / 2),
          left: Math.round(window.innerWidth / 2),
        }
      }
    },
    [],
  )

  // ── Task loaded callback ───────────────────────────────────────────────────
  const handleTaskLoaded = useCallback(() => {
    taskLoadedRef.current = true
    const workspace = workspaceRef.current
    if (!workspace) return

    syncStartBlockVisibility(workspace, showStartBlock)
    syncWorkspacePresentation(workspace)
  }, [showStartBlock, syncWorkspacePresentation])

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace || !taskLoadedRef.current) return
    syncWorkspacePresentation(workspace)
  }, [blockViewMode, syncWorkspacePresentation])

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace || !taskLoadedRef.current) return

    syncStartBlockVisibility(workspace, showStartBlock)
    syncWorkspacePresentation(workspace)
  }, [showStartBlock, syncWorkspacePresentation])

  // ── Workspace ready callback ───────────────────────────────────────────────
  // This is the main workspace lifecycle hook. It attaches the change listener
  // that drives drag highlighting, shadow-block click handling, orphan sync,
  // history sync, and structure change propagation.
  const handleWorkspaceReady = useCallback(
    (workspace: Blockly.WorkspaceSvg | null) => {
      detachWorkspaceListener()
      unregisterToolboxDeleteArea()
      stopToolboxHoverTracking()
      workspaceRef.current = workspace
      onWorkspaceReady?.(workspace)

      if (!workspace) {
        taskLoadedRef.current = false
        suppressDeleteZoneForNextDragRef.current = false
        setIsDeleting(false)
        setToolboxDeleteZoneState('idle')
        shadowPicker.close()
        syncHistoryState(null)
        return
      }

      // ── Shadow block helpers (local to this workspace instance) ────────────

      const getShadowBlocks = (ws: Blockly.WorkspaceSvg): Blockly.BlockSvg[] =>
        ws.getAllBlocks(false).filter((b) => b.isShadow())

      const getDescendantIds = (block: Blockly.Block): Set<string> => {
        const ids = new Set<string>()
        const queue = [...block.getChildren(false)]
        while (queue.length > 0) {
          const child = queue.pop()!
          ids.add(child.id)
          queue.push(...child.getChildren(false))
        }
        return ids
      }

      const highlightCompatibleShadowBlocks = (
        ws: Blockly.WorkspaceSvg,
        draggedBlock: Blockly.Block,
        draggedBlockId: string,
      ) => {
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

      const clearShadowBlockHighlights = (ws: Blockly.WorkspaceSvg) => {
        getShadowBlocks(ws).forEach((block) => {
          const svgRoot = block.getSvgRoot?.()
          if (!svgRoot) return
          svgRoot.classList.remove(
            'shadow-block--drag-target',
            'shadow-block--drag-incompatible',
          )
          setShadowIconState(block, false)
        })
      }

      // ── Main workspace event listener ──────────────────────────────────────
      const listener = (event: Blockly.Events.Abstract) => {
        if (event.type === Blockly.Events.BLOCK_DELETE) {
          syncStartBlockVisibility(workspace, showStartBlockRef.current)
          stopToolboxHoverTracking()
          setIsDeleting(false)
          setToolboxDeleteZoneState('idle')
          deleteAreaRef.current?.reset()
          clearShadowBlockHighlights(workspace)
        }

        // Drag start / end: toggle "delete zone" mode and shadow highlighting
        if (event.type === Blockly.Events.BLOCK_DRAG) {
          const dragEvent = event as Blockly.Events.Abstract & {
            isStart?: boolean
          }
          if (dragEvent.isStart === true) {
            lastDragGroupRef.current =
              event.group || Blockly.utils.idGenerator.genUid()
            lastDragEndTimeRef.current = 0

            const selected = Blockly.common.getSelected?.()
            const selectedBlockId =
              selected instanceof Blockly.BlockSvg ? selected.id : undefined
            const draggedBlockId =
              ((event as any).blockId as string | undefined) ?? selectedBlockId
            const draggedBlock = draggedBlockId
              ? workspace.getBlockById(draggedBlockId)
              : null
            const isToolboxOriginDrag = suppressDeleteZoneForNextDragRef.current
            if (isToolboxOriginDrag) {
              suppressDeleteZoneForNextDragRef.current = false
            }

            // Only show delete zone if dragging from workspace (not from toolbox)
            if (
              draggedBlock &&
              !draggedBlock.isInFlyout &&
              !isToolboxOriginDrag
            ) {
              setIsDeleting(true)
              setToolboxDeleteZoneState('drag-intent')
              startToolboxHoverTracking()
              deleteAreaRef.current?.setActiveDragGroup(
                lastDragGroupRef.current,
              )
            }

            if (draggedBlock && draggedBlockId)
              highlightCompatibleShadowBlocks(
                workspace,
                draggedBlock,
                draggedBlockId,
              )
          } else if (dragEvent.isStart === false) {
            lastDragEndTimeRef.current = Date.now()
            suppressDeleteZoneForNextDragRef.current = false
            stopToolboxHoverTracking()
            setIsDeleting(false)
            setToolboxDeleteZoneState('idle')
            clearShadowBlockHighlights(workspace)
            deleteAreaRef.current?.reset()
            if (taskLoadedRef.current) {
              syncWorkspacePresentation(workspace)
            }
          }
        }

        // Retroactively unify drag-group IDs for the undo stack so that a drag
        // from the custom toolbox (which fires create + move events separately)
        // can be undone in a single step.
        if (
          ['move', 'drag', 'delete', 'create', 'change'].includes(
            `${event.type}`,
          ) &&
          !(event as any).group &&
          lastDragGroupRef.current &&
          lastDragEndTimeRef.current > 0 &&
          Date.now() - lastDragEndTimeRef.current < 300
        ) {
          const undoStack = (workspace as any).undoStack_ as any[] | undefined
          if (undoStack && undoStack.length > 0) {
            const top = undoStack[undoStack.length - 1]
            if (!top.group) top.group = lastDragGroupRef.current
          }
        }

        // Shadow block click: open the picker
        if (`${event.type}` === `${Blockly.Events.CLICK}`) {
          if (workspace.options.readOnly) {
            shadowPicker.close()
            return
          }
          const clickEvent = event as Blockly.Events.Click & {
            blockId?: string
          }
          if (!clickEvent.blockId) {
            shadowPicker.close()
            return
          }
          const clickedBlock = workspace.getBlockById(clickEvent.blockId)
          if (!clickedBlock || !clickedBlock.isShadow()) {
            shadowPicker.close()
            return
          }
          const nextPopoverType = resolveShadowPopoverType(clickedBlock.type)
          if (!nextPopoverType) {
            shadowPicker.close()
            return
          }
          workspace.hideChaff()
          setContextMenu(null)
          const svgRoot = clickedBlock.getSvgRoot?.()
          svgRoot?.classList.add('shadow-block--selected')
          setShadowIconState(clickedBlock, true)
          shadowPicker.open(
            clickedBlock.id,
            nextPopoverType,
            resolveShadowPickerPosition(workspace, clickedBlock),
          )
          return
        }

        if (ORPHAN_SYNC_TYPES.has(event.type)) {
          if (taskLoadedRef.current) {
            syncWorkspacePresentation(workspace)
          }
        }

        syncHistoryState(workspace)

        if (STRUCTURE_CHANGING_TYPES.has(event.type)) {
          if (onTaskStructureChangeRef.current) {
            const structure = getBlocklyStructure()
            const abstract = blocklyToAbstractAll(
              structure as CustomBlock[] | null,
            )
            onTaskStructureChangeRef.current(abstract)
          }
        }
      }

      workspace.addChangeListener(listener)
      workspaceChangeListenerRef.current = listener

      // Keyboard Delete/Backspace: show confirmation modal before multi-block delete
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return
        const active = document.activeElement
        if (!active) return
        const isInsideWorkspace = Array.from(
          document.querySelectorAll('.injectionDiv'),
        ).some((div) => div === active || div.contains(active))
        if (!isInsideWorkspace) return
        const selected = Blockly.common.getSelected?.()
        if (!selected || !(selected instanceof Blockly.BlockSvg)) return
        if (selected.isShadow()) return
        if (selected.type === START_BLOCK_TYPE) return
        const ownDescendants = getOwnBodyDescendants(selected).filter(
          (b) => !b.isShadow() && !b.isInsertionMarker(),
        )
        const totalCount = 1 + ownDescendants.length
        if (!shouldConfirmDeleteRef.current(totalCount)) return
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
      keydownCleanupRef.current = () =>
        document.removeEventListener('keydown', handleKeyDown, {
          capture: true,
        })

      syncHistoryState(workspace)
      registerToolboxDeleteArea(workspace, toolboxRootRef.current)
    },
    [
      detachWorkspaceListener,
      unregisterToolboxDeleteArea,
      registerToolboxDeleteArea,
      startToolboxHoverTracking,
      stopToolboxHoverTracking,
      resolveShadowPickerPosition,
      syncHistoryState,
      shadowPicker,
      onWorkspaceReady,
      syncWorkspacePresentation,
    ],
  )

  // ── Toolbox root ref callback ──────────────────────────────────────────────
  const handleToolboxRootRefChange = useCallback(
    (element: HTMLElement | null) => {
      toolboxRootRef.current = element
      registerToolboxDeleteArea(workspaceRef.current, element)
    },
    [registerToolboxDeleteArea],
  )

  // ── Undo / Redo ────────────────────────────────────────────────────────────

  const handleUndo = useCallback(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    let stack = workspace.getUndoStack()
    if (stack.length === 0) return

    const undoGroup = (group: string | undefined) => {
      workspace.undo(false)
      if (group) {
        let remaining = workspace.getUndoStack()
        while (
          remaining.length > 0 &&
          remaining[remaining.length - 1].group === group
        ) {
          workspace.undo(false)
          remaining = workspace.getUndoStack()
        }
      }
    }

    // 1. First, if the very top of the stack is 'ghost-restore', undo all of them silently.
    while (
      stack.length > 0 &&
      stack[stack.length - 1].group === 'ghost-restore'
    ) {
      undoGroup('ghost-restore')
      stack = workspace.getUndoStack()
    }

    // 2. Now, the top of the stack is a real action. Undo it!
    if (stack.length > 0) {
      const topGroup = stack[stack.length - 1].group
      undoGroup(topGroup)
    }

    // 3. Just in case there are any older ghost-restores right under it, clear those too.
    let afterStack = workspace.getUndoStack()
    while (
      afterStack.length > 0 &&
      afterStack[afterStack.length - 1].group === 'ghost-restore'
    ) {
      undoGroup('ghost-restore')
      afterStack = workspace.getUndoStack()
    }

    syncHistoryState(workspace)
  }, [syncHistoryState])

  const handleRedo = useCallback(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    const redoStack = getRedoStack(workspace)
    if (redoStack.length === 0) return

    const redoGroup = (group: string | undefined) => {
      workspace.undo(true)
      if (group) {
        let remaining = getRedoStack(workspace)
        while (
          remaining.length > 0 &&
          remaining[remaining.length - 1].group === group
        ) {
          workspace.undo(true)
          remaining = getRedoStack(workspace)
        }
      }
    }

    const topGroup = redoStack[redoStack.length - 1].group
    redoGroup(topGroup)

    let afterStack = getRedoStack(workspace)
    while (
      afterStack.length > 0 &&
      afterStack[afterStack.length - 1].group === 'ghost-restore'
    ) {
      redoGroup('ghost-restore')
      afterStack = getRedoStack(workspace)
    }

    syncHistoryState(workspace)
  }, [syncHistoryState])

  // ── Zoom controls ──────────────────────────────────────────────────────────
  const handleZoomIn = useCallback(
    () => workspaceRef.current?.zoomCenter(1),
    [],
  )
  const handleZoomOut = useCallback(
    () => workspaceRef.current?.zoomCenter(-1),
    [],
  )
  const handleZoomToFit = useCallback(
    () => workspaceRef.current?.zoomToFit(),
    [],
  )

  // ── Context menu ───────────────────────────────────────────────────────────
  const handleCloseContextMenu = useCallback(() => setContextMenu(null), [])

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
        if (
          block instanceof Blockly.BlockSvg &&
          !block.isShadow() &&
          block.type !== START_BLOCK_TYPE
        ) {
          const ownDescendants = getOwnBodyDescendants(block).filter(
            (b) => !b.isShadow(),
          )
          const totalCount = 1 + ownDescendants.length
          if (shouldConfirmDelete(totalCount)) {
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
    [contextMenu, shouldConfirmDelete],
  )

  // ── Toolbox block drag initiator ───────────────────────────────────────────
  const handleBlockPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, item: ToolboxBlockItem) => {
      if (e.button !== 0) return
      const workspace = workspaceRef.current
      if (!workspace || workspace.options.readOnly) return
      e.preventDefault()
      workspace.hideChaff()
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
        if (pendingDragCleanupRef.current === cleanup)
          pendingDragCleanupRef.current = null
      }

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        const distance = Math.hypot(
          moveEvent.clientX - startX,
          moveEvent.clientY - startY,
        )
        if (distance < DRAG_THRESHOLD_PX) return
        suppressDeleteZoneForNextDragRef.current = true
        window.dispatchEvent(new Event('toolboxDragStart'))
        cleanup()
        startSyntheticBlockDrag(moveEvent, sourceElement, item, workspace)
      }

      const onPointerEnd = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== pointerId) return
        cleanup()
      }

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerEnd)
      window.addEventListener('pointercancel', onPointerEnd)
      pendingDragCleanupRef.current = cleanup
    },
    [],
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={[
        'custom-dragdrop-layout',
        `workspace-view--${blockViewMode}`,
        showStartBlock ? 'workspace-start--visible' : 'workspace-start--hidden',
      ].join(' ')}
    >
      <CustomToolbox
        dataObjects={dataObjects}
        dataLocations={dataLocations}
        dataActions={dataActions}
        dataMacros={availableMacros}
        isDeleting={isDeleting}
        deleteZoneState={toolboxDeleteZoneState}
        blockViewMode={blockViewMode}
        onRootRefChange={handleToolboxRootRefChange}
        onBlockPointerDown={handleBlockPointerDown}
        macroDetailsById={macroDetailsById}
      />
      <div
        className="custom-dragdrop-workspace-wrapper"
        onContextMenu={(e) => e.preventDefault()}
      >
        <BlocklyWorkspace
          dataTask={dataTask}
          editMode={editMode}
          pendingExternalTask={pendingExternalTask}
          applyExternalTaskState={applyExternalTaskState}
          onExternalTaskStateApplied={onExternalTaskStateApplied}
          onWorkspaceReady={handleWorkspaceReady}
          onTaskLoaded={handleTaskLoaded}
        />

        {/* Workspace controls overlay: undo/redo + zoom */}
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
            {onViewSettingsChange && viewSettings && (
              <IconButton
                className="workspace-control-button"
                size="small"
                onClick={handleOpenSettings}
                aria-label="Workspace Settings"
              >
                <Settings size={18} />
              </IconButton>
            )}
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

        {/* Shadow block picker — opened when user clicks a "+" shadow block */}
        <ShadowPickerMenu
          isOpen={shadowPicker.isOpen}
          position={shadowPicker.position}
          popoverType={shadowPicker.popoverType}
          groupedItems={shadowPicker.groupedItems}
          filteredItems={shadowPicker.filteredItems}
          searchQuery={shadowPicker.searchQuery}
          onSearchChange={shadowPicker.setSearchQuery}
          onSelect={shadowPicker.selectItem}
          onClose={shadowPicker.close}
        />

        {/* Context menu — opened via right-click on a block */}
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

        {/* Break into steps confirmation dialog */}
        {inlineTaskConfirm && (
          <InlineTaskDialog
            open
            macroName={inlineTaskConfirm.macroName}
            onConfirm={() => {
              inlineTaskConfirm.onConfirm()
              setInlineTaskConfirm(null)
            }}
            onCancel={() => setInlineTaskConfirm(null)}
          />
        )}

        {/* Generic delete confirmation dialog */}
        {confirmDialog && (
          <ConfirmDeleteDialog
            open
            message={confirmDialog.message}
            onConfirm={confirmDialog.onConfirm}
            onCancel={confirmDialog.onCancel}
          />
        )}

        {/* Workspace settings popover */}
        {onViewSettingsChange && viewSettings && (
          <Popover
            open={isSettingsOpen}
            anchorEl={settingsAnchorEl}
            onClose={handleCloseSettings}
            anchorOrigin={{
              vertical: 'bottom',
              horizontal: 'right',
            }}
            transformOrigin={{
              vertical: 'top',
              horizontal: 'right',
            }}
            slotProps={{
              paper: {
                sx: {
                  p: 2.5,
                  mt: 1,
                  width: 320,
                  borderRadius: 3,
                  boxShadow:
                    '0 10px 30px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.02)',
                  border: '1px solid rgba(148, 163, 184, 0.12)',
                },
              },
            }}
          >
            <Stack spacing={2.5}>
              <Box>
                <Typography
                  variant="h6"
                  sx={{ fontSize: 15, fontWeight: 700, color: 'text.primary' }}
                >
                  Workspace Settings
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}
                >
                  Adjust the visual editor and safety controls.
                </Typography>
              </Box>

              <Box>
                <Typography
                  variant="subtitle2"
                  sx={{
                    mb: 1,
                    fontWeight: 650,
                    fontSize: 13,
                    color: 'text.primary',
                  }}
                >
                  Block Visualization
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  fullWidth
                  size="small"
                  value={viewSettings.blockViewMode}
                  onChange={(_e, val) =>
                    val && onViewSettingsChange({ blockViewMode: val })
                  }
                >
                  <ToggleButton value="complete" sx={{ fontSize: 12, py: 0.5 }}>
                    Complete
                  </ToggleButton>
                  <ToggleButton
                    value="essential"
                    sx={{ fontSize: 12, py: 0.5 }}
                  >
                    Essential
                  </ToggleButton>
                  <ToggleButton value="minimal" sx={{ fontSize: 12, py: 0.5 }}>
                    Minimal
                  </ToggleButton>
                </ToggleButtonGroup>
              </Box>

              <Box>
                <Typography
                  variant="subtitle2"
                  sx={{
                    mb: 1,
                    fontWeight: 650,
                    fontSize: 13,
                    color: 'text.primary',
                  }}
                >
                  Delete Confirmations
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  fullWidth
                  size="small"
                  value={viewSettings.deleteConfirmMode}
                  onChange={(_e, val) =>
                    val && onViewSettingsChange({ deleteConfirmMode: val })
                  }
                >
                  <ToggleButton value="always" sx={{ fontSize: 12, py: 0.5 }}>
                    Always
                  </ToggleButton>
                  <ToggleButton value="multiple" sx={{ fontSize: 12, py: 0.5 }}>
                    Multiple
                  </ToggleButton>
                  <ToggleButton value="never" sx={{ fontSize: 12, py: 0.5 }}>
                    Never
                  </ToggleButton>
                </ToggleButtonGroup>
              </Box>

              <Box>
                <Stack
                  direction="row"
                  sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Box>
                    <Typography
                      variant="subtitle2"
                      sx={{
                        fontWeight: 650,
                        fontSize: 13,
                        color: 'text.primary',
                      }}
                    >
                      Show Start Block
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        color: 'text.secondary',
                        display: 'block',
                        maxWidth: 200,
                      }}
                    >
                      Hiding start block disables orphan highlighting.
                    </Typography>
                  </Box>
                  <Switch
                    checked={viewSettings.showStartBlock}
                    onChange={(_e, checked) =>
                      onViewSettingsChange({ showStartBlock: checked })
                    }
                    size="small"
                  />
                </Stack>
              </Box>

              {onResetViewSettings && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={onResetViewSettings}
                  fullWidth
                  sx={{ borderRadius: 2, fontSize: 12 }}
                >
                  Restore Defaults
                </Button>
              )}
            </Stack>
          </Popover>
        )}
      </div>
    </div>
  )
}
