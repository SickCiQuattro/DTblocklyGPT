import { useEffect, useRef } from 'react'
import * as Blockly from 'blockly/core'
import * as locale from 'blockly/msg/en'
import 'blockly/blocks'
import ModernTheme from '@blockly/theme-modern'
import { useAppSelector } from 'store/reducers'
import { State } from 'blockly/core/serialization/blocks'
import { useSearchParams } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { toggleEditMode } from 'store/reducers/task'

Blockly.setLocale(locale as unknown as { [key: string]: string })

export const getBlocklyStructure = (): State | null => {
  const workspace = Blockly.getMainWorkspace()
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
    if (event.type !== Blockly.Events.SELECTED) return
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
  dataTask: State
  onWorkspaceReady?: (workspace: Blockly.WorkspaceSvg | null) => void
}

export const BlocklyComponent = ({
  dataTask,
  onWorkspaceReady,
}: BlocklyComponentProps) => {
  const { editMode } = useAppSelector((state) => state.task)
  const blocklyDiv = useRef<HTMLDivElement | null>(null)
  const primaryWorkspace = useRef<Blockly.WorkspaceSvg | null>(null)
  const [searchParams] = useSearchParams()
  const newTaskParam = searchParams.get('newTask')
  const dispatch = useDispatch()

  useEffect(() => {
    console.log('BLOCKLY_EFFECT_TRIGGERED', new Date())

    // cleanup workspace div before injection
    if (blocklyDiv.current) {
      blocklyDiv.current.innerHTML = ''
    }

    const blocklyDivCurrent = blocklyDiv.current as Element

    // Inject Blockly WITHOUT a toolbox — the custom React toolbox is a sibling component.
    primaryWorkspace.current = Blockly.inject(blocklyDivCurrent, {
      renderer: 'thrasos',
      readOnly: !editMode,
      trashcan: false,
      media: '/blocklyMedia',
      move: { scrollbars: true, drag: true, wheel: true },
      zoom: { startScale: 1.5, controls: false, wheel: true, pinch: true },
      grid: {
        spacing: 18,
        length: 2,
        colour: '#CBD5E1',
        snap: true,
      },
      sounds: false,
      collapse: true,
      comments: true,
      theme: ModernTheme,
    })

    // observer variables
    let resizeObserver: ResizeObserver | null = null
    let detachChainSelection: (() => void) | null = null

    if (primaryWorkspace.current) {
      disableContextMenuItems()
      const workspace = primaryWorkspace.current
      detachChainSelection = enableChainSelection(workspace)
      onWorkspaceReady?.(workspace)

      if (dataTask) {
        const defaultDataTask = { ...dataTask }
        defaultDataTask.x = dataTask?.x || 200
        defaultDataTask.y = dataTask?.y || 100

        Blockly.serialization.blocks.append(defaultDataTask, workspace)
      }

      if (blocklyDivCurrent) {
        resizeObserver = new ResizeObserver(() => {
          if (primaryWorkspace.current) {
            Blockly.svgResize(primaryWorkspace.current)
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

      if (primaryWorkspace.current) {
        primaryWorkspace.current.dispose()
        primaryWorkspace.current = null
      }
    }
  }, [editMode, dataTask, onWorkspaceReady])

  useEffect(() => {
    if (newTaskParam) {
      dispatch(toggleEditMode())
    }
  }, [newTaskParam, dispatch])

  return (
    <div
      ref={blocklyDiv}
      id="blocklyDiv"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    />
  )
}
