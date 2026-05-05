import * as Blockly from 'blockly/core'

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

  override onDragEnter(e: Blockly.IDraggable) {
    super.onDragEnter(e)
    this.toolboxElement.classList.add('custom-toolbox--delete-over')
  }

  override onDragExit(e: Blockly.IDraggable) {
    super.onDragExit(e)
    this.toolboxElement.classList.remove('custom-toolbox--delete-over')
  }

  override onDrop(dragElement: Blockly.IDraggable): void {
    this.toolboxElement.classList.remove('custom-toolbox--delete-over')
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
}
