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

import { disposeBlockWithBody } from 'utils/blocklySelection'

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
      // Same teardown as the keyboard and context-menu delete paths. Blockly's
      // own cascade orphans a value-input child whose parent sits in a
      // connection with a default shadow — a condition slot, for instance — so
      // dragging a When block to the toolbox could leave its condition behind
      // as a floating block. This was the last delete path still going
      // straight to dispose(), which the helper's own docstring forbids.
      disposeBlockWithBody(block, true)
    } finally {
      Blockly.Events.setGroup(false)
      this.activeDragGroup = null
    }
  }

  reset() {
    this.activeDragGroup = null
  }
}
