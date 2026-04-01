import * as Blockly from 'blockly/core'

class CustomCategory extends Blockly.ToolboxCategory {
  addColourBorder_(colour) {
    if (!this.rowDiv_) return
    this.rowDiv_.style.backgroundColor = colour
  }

  setSelected(isSelected) {
    if (this.rowDiv_ && this.htmlDiv_ && this.iconDom_) {
      const labelDom = this.rowDiv_.getElementsByClassName(
        'blocklyToolboxCategoryLabel',
      )[0] as HTMLElement | undefined
      this.rowDiv_.style.borderColor = this.colour_
      this.rowDiv_.style.borderStyle = 'solid'
      this.rowDiv_.style.borderWidth = '3px'
      if (isSelected) {
        // Change the background color of the div to white.
        this.rowDiv_.style.backgroundColor = 'white'
        // Set the colour of the text to the colour of the category.
        if (labelDom) labelDom.style.color = this.colour_
        ;(this.iconDom_ as HTMLElement).style.color = this.colour_
      } else {
        // Set the background back to the original colour.
        this.rowDiv_.style.backgroundColor = this.colour_
        // Set the text back to white.
        if (labelDom) labelDom.style.color = 'white'
        ;(this.iconDom_ as HTMLElement).style.color = 'white'
      }
      // This is used for accessibility purposes.
      Blockly.utils.aria.setState(
        /** @type {!Element} */ this.htmlDiv_,
        Blockly.utils.aria.State.SELECTED,
        isSelected,
      )
    }
  }

  /*   createIconDom_() {
    const iconImg = document.createElement('img')
    iconImg.src = '/blocklyMedia/category_icon.svg'
    iconImg.alt = 'Blockly Logo'
    iconImg.width = '25'
    iconImg.height = '25'
    return iconImg
  } */
}

Blockly.registry.register(
  Blockly.registry.Type.TOOLBOX_ITEM,
  Blockly.ToolboxCategory.registrationName,
  CustomCategory,
  true,
)
