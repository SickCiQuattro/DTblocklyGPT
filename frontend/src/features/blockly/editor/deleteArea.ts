import * as Blockly from 'blockly/core'

/**
 * Delete area mapped to the custom React toolbox sidebar.
 */
export class CustomToolboxDeleteArea extends Blockly.DeleteArea {
  private readonly toolboxElement: HTMLElement

  constructor(toolboxElement: HTMLElement) {
    super()
    this.toolboxElement = toolboxElement
    this.id = 'custom-toolbox-delete-area'
  }

  override getClientRect(): Blockly.utils.Rect | null {
    if (!this.toolboxElement.isConnected) {
      return null
    }

    const toolboxRect = this.toolboxElement.getBoundingClientRect()
    if (toolboxRect.width <= 0 || toolboxRect.height <= 0) {
      return null
    }

    const BIG_NUM = 10000000
    return new Blockly.utils.Rect(
      toolboxRect.top,
      toolboxRect.bottom,
      -BIG_NUM,
      toolboxRect.right,
    )
  }

  override onDragEnter(dragElement: Blockly.IDraggable) {
    super.onDragEnter(dragElement)
    this.toolboxElement.classList.add('custom-toolbox--delete-over')
  }

  override onDragExit(dragElement: Blockly.IDraggable) {
    super.onDragExit(dragElement)
    this.toolboxElement.classList.remove('custom-toolbox--delete-over')
  }

  override onDrop(dragElement: Blockly.IDraggable) {
    super.onDrop(dragElement)
    this.toolboxElement.classList.remove('custom-toolbox--delete-over')
  }
}
