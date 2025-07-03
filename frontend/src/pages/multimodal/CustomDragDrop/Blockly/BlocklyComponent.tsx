import React, { useEffect, useRef } from 'react'
import * as Blockly from 'blockly/core'
import * as locale from 'blockly/msg/en'
// import { Backpack } from '@blockly/workspace-backpack'
import 'blockly/blocks'
import { State } from 'blockly/core/serialization/blocks'
import { useSearchParams } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { toggleEditMode } from 'store/reducers/task'
import { AbstractStep } from 'pages/tasks/types'
import { blocklyToAbstract, CustomBlock } from 'utils/blocklyParser'

// @ts-expect-error: Blockly.setLocale may not be typed in the current Blockly version
Blockly.setLocale(locale)

export const getBlocklyStructure = (): State | null => {
  const workspace = Blockly.getMainWorkspace()
  const blocklyTaskStructure =
    Blockly.serialization.workspaces.save(workspace).blocks?.blocks
  if (!blocklyTaskStructure) return null
  return blocklyTaskStructure[0]
}

const disableContextMenuItems = () => {
  // Blockly.ContextMenuRegistry.registry.unregister('undoWorkspace')
  // Blockly.ContextMenuRegistry.registry.unregister('redoWorkspace')
  // Blockly.ContextMenuRegistry.registry.unregister('cleanWorkspace')
  if (Blockly.ContextMenuRegistry.registry.getItem('collapseWorkspace'))
    Blockly.ContextMenuRegistry.registry.unregister('collapseWorkspace')
  if (Blockly.ContextMenuRegistry.registry.getItem('expandWorkspace'))
    Blockly.ContextMenuRegistry.registry.unregister('expandWorkspace')
  // Blockly.ContextMenuRegistry.registry.unregister('workspaceDelete')
  // Blockly.ContextMenuRegistry.registry.unregister('blockDuplicate')
  if (Blockly.ContextMenuRegistry.registry.getItem('blockComment'))
    Blockly.ContextMenuRegistry.registry.unregister('blockComment')
  if (Blockly.ContextMenuRegistry.registry.getItem('blockInline'))
    Blockly.ContextMenuRegistry.registry.unregister('blockInline')
  if (Blockly.ContextMenuRegistry.registry.getItem('blockCollapseExpand'))
    Blockly.ContextMenuRegistry.registry.unregister('blockCollapseExpand')
  if (Blockly.ContextMenuRegistry.registry.getItem('blockDisable'))
    Blockly.ContextMenuRegistry.registry.unregister('blockDisable')
  // Blockly.ContextMenuRegistry.registry.unregister('blockDelete')
  if (Blockly.ContextMenuRegistry.registry.getItem('blockHelp'))
    Blockly.ContextMenuRegistry.registry.unregister('blockHelp')
}

interface BlocklyComponentProps {
  children: React.JSX.Element[]
  dataTask: State
  editingMode: boolean
  setTaskStructure: (task: AbstractStep[] | null) => void
  newChatResponse: boolean
  setNewChatResponse: (response: boolean) => void
}

const DEFAULT_X_AXIS = 50
const DEFAULT_Y_AXIS = 50

export const BlocklyComponent = ({
  children,
  dataTask,
  editingMode,
  setTaskStructure,
  newChatResponse,
  setNewChatResponse,
}: BlocklyComponentProps) => {
  const blocklyDiv = useRef<HTMLDivElement | null>(null)
  const toolbox = useRef<HTMLDivElement | null>(null)
  const primaryWorkspace = useRef<Blockly.WorkspaceSvg | null>(null)
  const [searchParams] = useSearchParams()
  const newTaskParam = searchParams.get('newTask')
  const dispatch = useDispatch()

  useEffect(() => {
    const blocklyTaskStructure = primaryWorkspace.current
      ? getBlocklyStructure()
      : {
          x: DEFAULT_X_AXIS,
          y: DEFAULT_Y_AXIS,
        }
    const x_axis = blocklyTaskStructure?.x
    const y_axis = blocklyTaskStructure?.y

    document.getElementById('blocklyDiv')!.innerHTML = ''

    // https://developers.google.com/blockly/guides/configure/web/configuration_struct?hl=en
    const blocklyDivCurrent = blocklyDiv.current as Element
    const toolboxCurrent = toolbox.current as Element
    primaryWorkspace.current = Blockly.inject(blocklyDivCurrent, {
      toolbox: toolboxCurrent,
      readOnly: !editingMode,
      trashcan: true,
      media: '/blocklyMedia',
      move: { scrollbars: false, drag: true, wheel: true },
      zoom: { startScale: 1.5 },
      sounds: false,
    })

    if (primaryWorkspace.current) {
      disableContextMenuItems()
      const workspace = primaryWorkspace.current

      // const backpack = new Backpack(workspace)
      // backpack.init()

      // Update the abstractTaskStructure when the workspace changes
      workspace.addChangeListener((event) => {
        if (event.type !== Blockly.Events.UI) {
          const blocklyTaskStructure = getBlocklyStructure()

          const abstractTask = blocklyToAbstract(
            blocklyTaskStructure as CustomBlock,
          )

          setTaskStructure(abstractTask)
        }
      })

      // Prevent adding more than one top-level block
      workspace.addChangeListener((e) => {
        if (e.type === Blockly.Events.BLOCK_MOVE) {
          setTimeout(() => {
            const workspace = primaryWorkspace.current
            if (!workspace) return
            const topBlocks = workspace.getTopBlocks(false)
            if (topBlocks.length > 1) {
              const event = e as Blockly.Events.BlockMove
              const movedBlock = workspace.getBlockById((event as any).blockId)
              if (
                movedBlock &&
                !movedBlock.getParent() &&
                event.reason &&
                event.reason[0] === 'drag'
              ) {
                alert('Only one top-level block is allowed.')
                Blockly.getMainWorkspace().undo(false)
              }
            }
          }, 0)
        }
      })

      if (dataTask) {
        const defaultDataTask = { ...dataTask }
        defaultDataTask.x = x_axis
        defaultDataTask.y = y_axis

        Blockly.serialization.blocks.append(defaultDataTask, workspace)
      }
    }
  }, [editingMode])

  useEffect(() => {
    if (primaryWorkspace.current && newChatResponse) {
      const workspace = primaryWorkspace.current
      const blocklyTaskStructure = getBlocklyStructure()
      const x_axis = blocklyTaskStructure?.x || DEFAULT_X_AXIS
      const y_axis = blocklyTaskStructure?.y || DEFAULT_Y_AXIS

      workspace.clear()

      if (dataTask) {
        const defaultDataTask = { ...dataTask }

        defaultDataTask.x = x_axis
        defaultDataTask.y = y_axis

        Blockly.serialization.blocks.append(defaultDataTask, workspace)
        setNewChatResponse(false)
      }
    }
  }, [newChatResponse])

  useEffect(() => {
    if (newTaskParam) {
      dispatch(toggleEditMode())
    }
  }, [])

  return (
    <>
      <div ref={blocklyDiv} id="blocklyDiv" />
      <div style={{ display: 'none' }} ref={toolbox}>
        {children}
      </div>
    </>
  )
}
