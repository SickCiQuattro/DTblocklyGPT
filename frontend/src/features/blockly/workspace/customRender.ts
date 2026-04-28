import * as Blockly from 'blockly/core'

class BooleanRoundConstants extends Blockly.blockRendering.ConstantProvider {
  ROUND_TAB!: any

  override init(): void {
    super.init()
    this.ROUND_TAB = {
      type: this.SHAPES.ROUND,
      width: this.TAB_WIDTH,
      height: this.TAB_HEIGHT,
      pathUp: Blockly.utils.svgPaths.line([
        Blockly.utils.svgPaths.point(-this.TAB_WIDTH, -this.TAB_HEIGHT / 2),
        Blockly.utils.svgPaths.point(this.TAB_WIDTH, -this.TAB_HEIGHT / 2),
      ]),
      pathDown: Blockly.utils.svgPaths.line([
        Blockly.utils.svgPaths.point(-this.TAB_WIDTH, this.TAB_HEIGHT / 2),
        Blockly.utils.svgPaths.point(this.TAB_WIDTH, this.TAB_HEIGHT / 2),
      ]),
    }
  }

  override shapeFor(connection: Blockly.RenderedConnection) {
    const check = connection.getCheck()
    if (check?.includes('Boolean')) {
      return this.ROUND_TAB
    }
    return super.shapeFor(connection)
  }
}

class ThrasonBooleanRenderer extends Blockly.thrasos.Renderer {
  protected override makeConstants_() {
    return new BooleanRoundConstants()
  }
}

Blockly.blockRendering.register('thrasos_boolean', ThrasonBooleanRenderer)
