import * as Blockly from 'blockly/core'

import { BlockState as State } from 'utils/blocklyTypes'

import { ToolboxBlockItem } from '../toolbox'

const getShadowInputs = (
  blockType: string,
): Record<string, any> | undefined => {
  switch (blockType) {
    case 'processing_block':
      return {
        ACTION: {
          shadow: {
            type: 'shadow_action_block',
            fields: { name: 'Select Procedure...' },
          },
        },
      }
    case 'pick_block':
    case 'find_object_block':
      return {
        OBJECT: {
          shadow: {
            type: 'shadow_object_block',
            fields: { name: 'Select Object...' },
          },
        },
      }
    case 'place_block':
    case 'move_to_block':
      return {
        LOCATION: {
          shadow: {
            type: 'shadow_location_block',
            fields: { name: 'Select Destination...' },
          },
        },
      }
    case 'when_block':
    case 'when_otherwise_block':
      return {
        WHEN: {
          shadow: {
            type: 'shadow_trigger_block',
            fields: { name: 'Select Condition...' },
          },
        },
      }
    case 'repeat_until_block':
      return {
        CONDITION: {
          shadow: {
            type: 'shadow_trigger_block',
            fields: { name: 'Select Condition...' },
          },
        },
      }
    case 'human_action_block':
      return {
        CONFIRM_EVENT: {
          shadow: {
            type: 'shadow_trigger_block',
            fields: { name: 'Select Condition...' },
          },
        },
      }
    case 'logic_and_block':
    case 'logic_or_block':
      return {
        A: {
          shadow: {
            type: 'shadow_trigger_block',
            fields: { name: 'Select Condition...' },
          },
        },
        B: {
          shadow: {
            type: 'shadow_trigger_block',
            fields: { name: 'Select Condition...' },
          },
        },
      }
    case 'logic_not_block':
      return {
        BOOL: {
          shadow: {
            type: 'shadow_trigger_block',
            fields: { name: 'Select Condition...' },
          },
        },
      }
    default:
      return undefined
  }
}
// ────────────────────────────────────────────────────────────────────────

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

  const shadowInputs = getShadowInputs(item.type)

  const blockState: State = {
    type: item.type,
    ...(hasFields ? { fields: item.fields } : {}),
    ...(hasData ? { data: item.data } : {}),
    ...(shadowInputs ? { inputs: shadowInputs } : {}),
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
