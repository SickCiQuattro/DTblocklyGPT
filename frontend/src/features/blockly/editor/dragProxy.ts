/**
 * dragProxy.ts
 *
 * Converts a React pointer event (from a custom toolbox pill) into a native
 * Blockly block-drag gesture without relying on the standard Blockly toolbox DOM.
 *
 * Entry point: `startSyntheticBlockDrag` — called by `BlocklyEditor` when the
 * pointer has moved past the drag threshold while pressing a toolbox block pill.
 *
 * The proxy creates a temporary "ghost" block in the workspace, hands pointer
 * capture to Blockly's gesture system, and cleans up when the drag ends.
 */
import * as Blockly from 'blockly/core'

import { BlockState as State, ConnectionState } from 'utils/blocklyTypes'
import { GHOST_INPUT_MAP } from 'utils/ghostBlockManager'

import { ToolboxBlockItem } from '../toolbox'

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
    Blockly.svgResize(workspace)
    const screenCoordinates = new Blockly.utils.Coordinate(
      pointerEvent.clientX,
      pointerEvent.clientY,
    )
    const workspaceCoords = Blockly.utils.svgMath.screenToWsCoordinates(
      workspace,
      screenCoordinates,
    )

    const dragGroupId = Blockly.utils.idGenerator.genUid()

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

    Blockly.Events.setGroup(dragGroupId)
    Blockly.Events.fire(new Blockly.Events.BlockCreate(capturedBlock))

    const capturedBlockId = capturedBlock.id

    const dragEndListener = (event: Blockly.Events.Abstract) => {
      if (event.type !== 'drag') return
      const dragEvent = event as Blockly.Events.Abstract & { isStart?: boolean }
      if (dragEvent.isStart !== false) return

      workspace.removeChangeListener(dragEndListener)

      let lastStackLength = -1
      let checkCount = 0
      const MAX_CHECKS = 10

      const waitForStableStack = () => {
        const stack = workspace.getUndoStack()
        if (!stack) return

        const currentLength = stack.length

        if (currentLength === lastStackLength || checkCount >= MAX_CHECKS) {
          for (const entry of stack) {
            const e = entry as any
            if (
              e.blockId === capturedBlockId ||
              e.newElementId === capturedBlockId
            ) {
              entry.group = dragGroupId
            }
          }

          const ourMoves = stack
            .map((e: any, i: number) => ({ e, i }))
            .filter(
              ({ e }: any) =>
                (e.blockId === capturedBlockId ||
                  e.newElementId === capturedBlockId) &&
                e.type === 'move',
            )

          if (ourMoves.length > 1) {
            ourMoves
              .slice(0, -1)
              .map(({ i }: any) => i)
              .sort((a: number, b: number) => b - a)
              .forEach((i: number) => stack.splice(i, 1))
          }
          return
        }

        lastStackLength = currentLength
        checkCount++
        requestAnimationFrame(waitForStableStack)
      }

      requestAnimationFrame(waitForStableStack)
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
