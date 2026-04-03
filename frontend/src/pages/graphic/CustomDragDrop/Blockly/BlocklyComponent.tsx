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
    document.getElementById('blocklyDiv')!.innerHTML = ''

    const blocklyDivCurrent = blocklyDiv.current as Element

    // Inject Blockly WITHOUT a toolbox — the custom React toolbox is a sibling component.
    primaryWorkspace.current = Blockly.inject(blocklyDivCurrent, {
      renderer: 'thrasos',
      readOnly: !editMode,
      trashcan: true,
      media: '/blocklyMedia',
      move: { scrollbars: true, drag: true, wheel: true },
      zoom: { startScale: 1.5, controls: true, wheel: true, pinch: true },
      grid: {
        spacing: 15,
        length: 2,
        colour: '#94A3B8',
        snap: true,
      },
      sounds: false,
      collapse: true,
      comments: true,
      theme: ModernTheme,
    })

    if (primaryWorkspace.current) {
      disableContextMenuItems()
      const workspace = primaryWorkspace.current
      onWorkspaceReady?.(workspace)

      if (dataTask) {
        const defaultDataTask = { ...dataTask }
        defaultDataTask.x = dataTask?.x || 200
        defaultDataTask.y = dataTask?.y || 100

        Blockly.serialization.blocks.append(defaultDataTask, workspace)
      }
    }

    return () => {
      if (primaryWorkspace.current) {
        onWorkspaceReady?.(null)
      }
    }
  }, [editMode])

  useEffect(() => {
    console.log('BLOCKLY_EFFECT_TRIGGERED', new Date())
    if (newTaskParam) {
      dispatch(toggleEditMode())
    }
  }, [])

  return (
    <div
      ref={blocklyDiv}
      id="blocklyDiv"
      style={{ width: '100%', height: '100%' }}
    />
  )
}
