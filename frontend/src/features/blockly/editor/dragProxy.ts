import * as Blockly from 'blockly/core'

import { BlockState as State, ConnectionState } from 'utils/blocklyTypes'
import { ToolboxBlockItem } from '../toolbox'
import { GHOST_INPUT_MAP } from 'utils/ghostBlockManager'

const getShadowInputs = (
  blockType: string,
): Record<string, ConnectionState> | undefined => {
  const inputMap = GHOST_INPUT_MAP[blockType]
  if (!inputMap) return undefined

  return Object.fromEntries(
    Object.entries(inputMap).map(([inputName, ghostDef]) => [
      inputName,
      {
        shadow: {
          type: ghostDef.type,
          fields: { name: ghostDef.label },
        },
      } satisfies ConnectionState,
    ]),
  )
}

/**
 * Convert a toolbox pill pointer interaction into a Blockly-native block drag gesture.
 */
export const startSyntheticBlockDrag = (
  pointerEvent: PointerEvent,
  sourceElement: HTMLDivElement,
  item: ToolboxBlockItem,
  workspace: Blockly.WorkspaceSvg,
) => {
  const shadowInputs = getShadowInputs(item.type)
  const hasFields = !!item.fields && Object.keys(item.fields).length > 0
  const hasData = typeof item.data === 'string' && item.data.length > 0

  const blockState: State = {
    type: item.type,
    ...(hasFields ? { fields: item.fields } : {}),
    ...(hasData ? { data: item.data } : {}),
    ...(shadowInputs ? { inputs: shadowInputs } : {}),
  }

  try {
    const screenCoordinates = new Blockly.utils.Coordinate(
      pointerEvent.clientX,
      pointerEvent.clientY,
    )
    const workspaceCoords = Blockly.utils.svgMath.screenToWsCoordinates(
      workspace,
      screenCoordinates,
    )

    // Crea il blocco silenziosamente — nessun evento
    Blockly.Events.disable()
    let block: Blockly.BlockSvg | null = null
    try {
      block = Blockly.serialization.blocks.append(
        blockState,
        workspace,
      ) as Blockly.BlockSvg
      block.initSvg()
      block.render()
      block.moveTo(
        new Blockly.utils.Coordinate(
          workspaceCoords.x - 20,
          workspaceCoords.y - 20,
        ),
      )
    } finally {
      Blockly.Events.enable()
    }

    if (!block) return

    const capturedBlock = block

    // Apri il gruppo PRIMA di fare fire del CREATE
    Blockly.Events.setGroup(true)
    const currentGroup = Blockly.Events.getGroup()

    // Registra manualmente il CREATE nello stack undo
    Blockly.Events.fire(new Blockly.Events.BlockCreate(capturedBlock))

    // Listener che chiude il gruppo dopo il drop
    const dragEndListener = (event: Blockly.Events.Abstract) => {
      const dragEvent = event as Blockly.Events.Abstract & { isStart?: boolean }
      if (`${event.type}` !== `${Blockly.Events.BLOCK_DRAG}`) return
      if (dragEvent.isStart !== false) return

      Blockly.Events.setGroup(false)
      workspace.removeChangeListener(dragEndListener)
    }

    workspace.addChangeListener(dragEndListener)

    if (sourceElement.hasPointerCapture(pointerEvent.pointerId)) {
      sourceElement.releasePointerCapture(pointerEvent.pointerId)
    }

    const svgRoot = capturedBlock.getSvgRoot()
    const syntheticEvent = new PointerEvent('pointerdown', {
      clientX: pointerEvent.clientX,
      clientY: pointerEvent.clientY,
      pointerId: pointerEvent.pointerId,
      button: 0,
      bubbles: true,
      cancelable: true,
      pointerType: pointerEvent.pointerType,
      isPrimary: pointerEvent.isPrimary,
    })

    svgRoot.dispatchEvent(syntheticEvent)
  } catch (error) {
    Blockly.Events.setGroup(false)
    console.error('Blockly Gesture Proxy Error:', error)
  }
}
