/**
 * BlocklyWorkspace.tsx
 *
 * React wrapper that manages the lifecycle of the main interactive Blockly
 * workspace: injection, task loading, external state application, and teardown.
 *
 * Calls:
 *  - `onWorkspaceReady(workspace)` once the workspace is injected and ready.
 *  - `onTaskLoaded()` after the initial `dataTask` has been deserialised.
 *  - `onExternalTaskStateApplied()` after a programmatic state update completes.
 *
 * Also exports `getBlocklyStructure()` — a module-level helper that returns the
 * top-most block in the active workspace (used by serialisation helpers).
 */
import { useEffect, useRef } from 'react'
import * as Blockly from 'blockly/core'
import * as locale from 'blockly/msg/en'
import 'blockly/blocks'

import { BlockState } from 'utils/blocklyTypes'
import { getOwnBodyDescendants } from 'utils/blocklySelection'
import {
  injectAllGhostBlocks,
  registerGhostRestoreListener,
  saveWorkspaceWithoutGhosts,
} from 'utils/ghostBlockManager'

import { isValidBlockState } from '../utils/serialization'

import { updateStructureAndFireFakeChangeEvent } from './chatSync'
import { INTERACTIVE_WORKSPACE_CONFIG } from './workspaceConfig'

const localeMessages: Record<string, string> = {}
for (const [key, value] of Object.entries(locale)) {
  if (typeof value === 'string') {
    localeMessages[key] = value
  }
}

Blockly.setLocale(localeMessages)

export const getBlocklyStructure = (): BlockState[] | null => {
  const workspace = Blockly.getMainWorkspace()
  if (!workspace) return null
  const blocklyTaskStructure = saveWorkspaceWithoutGhosts(
    workspace as Blockly.WorkspaceSvg,
  ).blocks?.blocks
  if (!blocklyTaskStructure || blocklyTaskStructure.length === 0) return null
  return blocklyTaskStructure as BlockState[]
}

const disableContextMenuItems = () => {
  if (Blockly.ContextMenuRegistry.registry.getItem('blockHelp'))
    Blockly.ContextMenuRegistry.registry.unregister('blockHelp')
}

const enableChainSelection = (workspace: Blockly.WorkspaceSvg) => {
  let syncingSelection = false

  const listener = (event: Blockly.Events.Abstract) => {
    if (`${event.type}` !== `${Blockly.Events.SELECTED}`) return
    if (syncingSelection) return

    const selectedEvent = event as Blockly.Events.Selected
    syncingSelection = true

    try {
      if (selectedEvent.oldElementId) {
        const oldBlock = workspace.getBlockById(selectedEvent.oldElementId)
        if (oldBlock instanceof Blockly.BlockSvg) {
          getOwnBodyDescendants(oldBlock).forEach((b) => b.removeSelect())
        }
      }
      if (selectedEvent.newElementId) {
        const newBlock = workspace.getBlockById(selectedEvent.newElementId)
        if (newBlock instanceof Blockly.BlockSvg) {
          getOwnBodyDescendants(newBlock).forEach((b) => b.addSelect())
        }
      }
    } finally {
      syncingSelection = false
    }
  }

  workspace.addChangeListener(listener)
  return () => workspace.removeChangeListener(listener)
}

interface BlocklyComponentProps {
  dataTask: BlockState | BlockState[] | null
  editMode: boolean
  pendingExternalTask?: BlockState | BlockState[] | null
  onWorkspaceReady?: (workspace: Blockly.WorkspaceSvg | null) => void
  applyExternalTaskState?: boolean
  onExternalTaskStateApplied?: () => void
  onTaskLoaded?: () => void
}

const DEFAULT_X_AXIS = 200
const DEFAULT_Y_AXIS = 100

export const BlocklyWorkspace = ({
  dataTask,
  editMode,
  pendingExternalTask,
  onWorkspaceReady,
  applyExternalTaskState = false,
  onExternalTaskStateApplied,
  onTaskLoaded,
}: BlocklyComponentProps) => {
  const blocklyDivRef = useRef<HTMLDivElement | null>(null)
  const primaryWorkspaceRef = useRef<Blockly.WorkspaceSvg | null>(null)

  const onWorkspaceReadyRef = useRef(onWorkspaceReady)
  useEffect(() => {
    onWorkspaceReadyRef.current = onWorkspaceReady
  })

  const onExternalTaskStateAppliedRef = useRef(onExternalTaskStateApplied)
  useEffect(() => {
    onExternalTaskStateAppliedRef.current = onExternalTaskStateApplied
  })

  const onTaskLoadedRef = useRef(onTaskLoaded)
  useEffect(() => {
    onTaskLoadedRef.current = onTaskLoaded
  })

  useEffect(() => {
    if (blocklyDivRef.current) {
      blocklyDivRef.current.innerHTML = ''
    }

    const blocklyDivCurrent = blocklyDivRef.current as Element
    const workspaceConfig: Blockly.BlocklyOptions = {
      ...INTERACTIVE_WORKSPACE_CONFIG,
      readOnly: !editMode,
    }

    primaryWorkspaceRef.current = Blockly.inject(blocklyDivCurrent, {
      ...workspaceConfig,
      disable: true,
    })

    let resizeObserver: ResizeObserver | null = null
    let detachChainSelection: (() => void) | null = null
    let detachGhostListener: (() => void) | null = null

    if (primaryWorkspaceRef.current) {
      disableContextMenuItems()
      const workspace = primaryWorkspaceRef.current
      detachChainSelection = enableChainSelection(workspace)
      detachGhostListener = registerGhostRestoreListener(workspace)

      onWorkspaceReadyRef.current?.(workspace)

      if (isValidBlockState(dataTask)) {
        Blockly.Events.disable()
        try {
          if (Array.isArray(dataTask)) {
            dataTask.forEach((block) => {
              const defaultDataTask = { ...block }
              defaultDataTask.x = block.x ?? DEFAULT_X_AXIS
              defaultDataTask.y = block.y ?? DEFAULT_Y_AXIS
              Blockly.serialization.blocks.append(defaultDataTask, workspace)
            })
          } else {
            let defaultDataTask = { ...dataTask }
            if (defaultDataTask.type !== 'when_start') {
              defaultDataTask = {
                type: 'when_start',
                x: DEFAULT_X_AXIS,
                y: DEFAULT_Y_AXIS,
                next: {
                  block: defaultDataTask,
                },
              }
            } else {
              defaultDataTask.x = dataTask?.x ?? DEFAULT_X_AXIS
              defaultDataTask.y = dataTask?.y ?? DEFAULT_Y_AXIS
            }
            Blockly.serialization.blocks.append(defaultDataTask, workspace)
          }
          injectAllGhostBlocks(workspace)
        } finally {
          Blockly.Events.enable()
        }

        onTaskLoadedRef.current?.()
      } else {
        onTaskLoadedRef.current?.()
      }

      if (blocklyDivCurrent) {
        resizeObserver = new ResizeObserver(() => {
          if (primaryWorkspaceRef.current) {
            Blockly.svgResize(primaryWorkspaceRef.current)
          }
        })
        resizeObserver.observe(blocklyDivCurrent)
      }
    }

    return () => {
      resizeObserver?.disconnect()
      detachChainSelection?.()
      detachGhostListener?.()
      onWorkspaceReadyRef.current?.(null)

      if (primaryWorkspaceRef.current) {
        primaryWorkspaceRef.current.dispose()
        primaryWorkspaceRef.current = null
      }
    }
  }, [editMode, dataTask])

  useEffect(() => {
    if (!applyExternalTaskState) return
    if (!primaryWorkspaceRef.current) {
      console.error(
        'External task state was ready to apply but the Blockly workspace is not injected yet',
      )
      return
    }
    if (!isValidBlockState(pendingExternalTask)) {
      console.error(
        'External task state was ready to apply but pendingExternalTask is not a valid block state',
        pendingExternalTask,
      )
      return
    }

    const workspace = primaryWorkspaceRef.current
    const blocklyTaskStructure = getBlocklyStructure()
    const firstBlock = Array.isArray(blocklyTaskStructure)
      ? blocklyTaskStructure[0]
      : blocklyTaskStructure
    const x_axis = firstBlock?.x ?? DEFAULT_X_AXIS
    const y_axis = firstBlock?.y ?? DEFAULT_Y_AXIS

    updateStructureAndFireFakeChangeEvent(
      workspace,
      pendingExternalTask,
      x_axis,
      y_axis,
    )

    onTaskLoadedRef.current?.()
    onExternalTaskStateAppliedRef.current?.()
  }, [applyExternalTaskState, pendingExternalTask])

  return (
    <div
      ref={blocklyDivRef}
      id="blocklyDiv"
      // The "Skip to blocks workspace" link (BlocklyEditor.tsx) targets this
      // id — without tabIndex, a plain div can't receive focus, so the link
      // would scroll here but leave keyboard focus behind on the page.
      tabIndex={-1}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    />
  )
}
