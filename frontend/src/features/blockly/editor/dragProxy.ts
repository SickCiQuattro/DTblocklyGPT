import * as Blockly from 'blockly/core'

import { BlockState as State } from 'utils/blocklyTypes'

import { ToolboxBlockItem } from '../toolbox'

/**
 * Convert a toolbox pill pointer interaction into a Blockly-native block drag gesture.
 */
export const startSyntheticBlockDrag = (
  pointerEvent: PointerEvent,
  sourceElement: HTMLDivElement,
  item: ToolboxBlockItem,
  workspace: Blockly.WorkspaceSvg,
) => {
  const hasFields = !!item.fields && Object.keys(item.fields).length > 0
  const hasData = typeof item.data === 'string' && item.data.length > 0

  const blockState: State = {
    type: item.type,
    ...(hasFields ? { fields: item.fields } : {}),
    ...(hasData ? { data: item.data } : {}),
  }

  try {
    Blockly.Events.disable()

    let block: Blockly.BlockSvg | null = null
    try {
      block = Blockly.serialization.blocks.append(
        blockState,
        workspace,
      ) as Blockly.BlockSvg

      block.initSvg()
      block.render()

      const screenCoordinates = new Blockly.utils.Coordinate(
        pointerEvent.clientX,
        pointerEvent.clientY,
      )
      const workspaceCoords = Blockly.utils.svgMath.screenToWsCoordinates(
        workspace,
        screenCoordinates,
      )
      block.moveTo(
        new Blockly.utils.Coordinate(
          workspaceCoords.x - 20,
          workspaceCoords.y - 20,
        ),
      )
    } finally {
      Blockly.Events.enable()
    }

    if (!block) {
      return
    }

    if (Blockly.Events.isEnabled()) {
      Blockly.Events.fire(new Blockly.Events.BlockCreate(block))
    }

    if (sourceElement.hasPointerCapture(pointerEvent.pointerId)) {
      sourceElement.releasePointerCapture(pointerEvent.pointerId)
    }

    const svgRoot = block.getSvgRoot()
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
    console.error('Blockly Gesture Proxy Error:', error)
  }
}
