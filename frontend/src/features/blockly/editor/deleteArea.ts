/**
 * deleteArea.ts
 *
 * Registers the custom React toolbox container as a Blockly `DeleteArea` so
 * that blocks dragged over the toolbox panel are deleted rather than snapping
 * back to their original position.
 *
 * Visual state (idle / drag-intent / hover-confirm) is handled in the parent
 * editor component; this class only defines delete hit-testing and drop logic.
 */
import * as Blockly from 'blockly/core'

export type DeleteZoneState = 'idle' | 'drag-intent' | 'hover-confirm'

export class CustomToolboxDeleteArea extends Blockly.DeleteArea {
  private readonly toolboxElement: HTMLElement
  private activeDragGroup: string | null = null

  constructor(toolboxElement: HTMLElement) {
    super()
    this.toolboxElement = toolboxElement
    this.id = 'custom-toolbox-delete-area'
  }

  setActiveDragGroup(group: string | null) {
    this.activeDragGroup = group
  }

  override getClientRect(): Blockly.utils.Rect | null {
    if (!this.toolboxElement.isConnected) return null
    const r = this.toolboxElement.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return null
    const BIG = 10000000
    return new Blockly.utils.Rect(r.top, r.bottom, -BIG, r.right)
  }

  override onDrop(dragElement: Blockly.IDraggable): void {
    const block = dragElement as Blockly.BlockSvg
    if (!block?.dispose) return

    const group = this.activeDragGroup ?? Blockly.utils.idGenerator.genUid()
    Blockly.Events.setGroup(group)
    try {
      block.dispose(false, true)
    } finally {
      Blockly.Events.setGroup(false)
      this.activeDragGroup = null
    }
  }

  reset() {
    this.activeDragGroup = null
  }
}
