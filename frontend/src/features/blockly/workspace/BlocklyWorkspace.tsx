import { useEffect, useRef } from 'react'
import * as Blockly from 'blockly/core'
import * as locale from 'blockly/msg/en'
import 'blockly/blocks'

import { BlockState } from 'utils/blocklyTypes'

import { isValidBlockState } from '../utils/serialization'
import { updateStructureAndFireFakeChangeEvent } from './chatSync'
import { INTERACTIVE_WORKSPACE_CONFIG } from './workspaceConfig'

Blockly.setLocale(locale as unknown as { [key: string]: string })

/**
 * Read the root serialized block currently mounted in the main Blockly workspace.
 */
export const getBlocklyStructure = (): BlockState | null => {
  const workspace = Blockly.getMainWorkspace()
  if (!workspace) return null

  const blocklyTaskStructure =
    Blockly.serialization.workspaces.save(workspace).blocks?.blocks
  if (!blocklyTaskStructure) return null
  return blocklyTaskStructure[0]
}

const disableContextMenuItems = () => {
  if (Blockly.ContextMenuRegistry.registry.getItem('blockHelp'))
    Blockly.ContextMenuRegistry.registry.unregister('blockHelp')
}

// Enables "chain selection"
const enableChainSelection = (workspace: Blockly.WorkspaceSvg) => {
  let syncingSelection = false

  const listener = (event: Blockly.Events.Abstract) => {
    // selection events
    if (`${event.type}` !== `${Blockly.Events.SELECTED}`) return
    if (syncingSelection) return

    const selectedEvent = event as Blockly.Events.Selected

    syncingSelection = true
    try {
      // 1. deselection
      if (selectedEvent.oldElementId) {
        const oldBlock = workspace.getBlockById(selectedEvent.oldElementId)
        if (oldBlock && oldBlock instanceof Blockly.BlockSvg) {
          const oldChain = oldBlock.getDescendants(true)
          oldChain.forEach((child) => {
            if (child.id !== oldBlock.id && child instanceof Blockly.BlockSvg) {
              child.removeSelect()
            }
          })
        }
      }

      // 2. new selection
      if (selectedEvent.newElementId) {
        const newBlock = workspace.getBlockById(selectedEvent.newElementId)
        if (newBlock && newBlock instanceof Blockly.BlockSvg) {
          const newChain = newBlock.getDescendants(true)
          newChain.forEach((child) => {
            if (child.id !== newBlock.id && child instanceof Blockly.BlockSvg) {
              child.addSelect()
            }
          })
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
  dataTask: BlockState | null
  editMode: boolean
  onWorkspaceReady?: (workspace: Blockly.WorkspaceSvg | null) => void
  applyExternalTaskState?: boolean
  onExternalTaskStateApplied?: () => void
}

const DEFAULT_X_AXIS = 200
const DEFAULT_Y_AXIS = 100

/**
 * Interactive Blockly workspace used by both graphic and multimodal layouts.
 */
export const BlocklyWorkspace = ({
  dataTask,
  editMode,
  onWorkspaceReady,
  applyExternalTaskState = false,
  onExternalTaskStateApplied,
}: BlocklyComponentProps) => {
  const blocklyDivRef = useRef<HTMLDivElement | null>(null)
  const primaryWorkspaceRef = useRef<Blockly.WorkspaceSvg | null>(null)

  useEffect(() => {
    // cleanup workspace div before injection
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
    })

    // observer variables
    let resizeObserver: ResizeObserver | null = null
    let detachChainSelection: (() => void) | null = null

    if (primaryWorkspaceRef.current) {
      disableContextMenuItems()
      const workspace = primaryWorkspaceRef.current
      detachChainSelection = enableChainSelection(workspace)
      onWorkspaceReady?.(workspace)

      if (isValidBlockState(dataTask)) {
        const defaultDataTask = { ...dataTask }
        defaultDataTask.x = dataTask?.x || DEFAULT_X_AXIS
        defaultDataTask.y = dataTask?.y || DEFAULT_Y_AXIS

        Blockly.serialization.blocks.append(defaultDataTask, workspace)
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

    // Cleanup phase
    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect()
      }

      if (detachChainSelection) {
        detachChainSelection()
        detachChainSelection = null
      }

      onWorkspaceReady?.(null)

      if (primaryWorkspaceRef.current) {
        primaryWorkspaceRef.current.dispose()
        primaryWorkspaceRef.current = null
      }
    }
  }, [editMode, dataTask, onWorkspaceReady])

  useEffect(() => {
    if (!primaryWorkspaceRef.current || !applyExternalTaskState) {
      return
    }

    if (!isValidBlockState(dataTask)) {
      return
    }

    const workspace = primaryWorkspaceRef.current
    const blocklyTaskStructure = getBlocklyStructure()
    const x_axis = blocklyTaskStructure?.x || DEFAULT_X_AXIS
    const y_axis = blocklyTaskStructure?.y || DEFAULT_Y_AXIS

    const defaultDataTask = { ...dataTask }
    defaultDataTask.x = x_axis
    defaultDataTask.y = y_axis

    updateStructureAndFireFakeChangeEvent(workspace, defaultDataTask)
    onExternalTaskStateApplied?.()
  }, [applyExternalTaskState, dataTask, onExternalTaskStateApplied])

  return (
    <div
      ref={blocklyDivRef}
      id="blocklyDiv"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    />
  )
}
