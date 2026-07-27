/**
 * palette.ts
 *
 * Central colour palette for all Blockly block categories.
 * This is the single source of truth for category colours — import from
 * this module whenever a block definition or UI component needs to
 * reference a category colour programmatically.
 */

/**
 * Hex colour values assigned to each logical block category.
 * Keys are semantic category names; values are used by both the block
 * renderer (Blockly JSON definitions) and the React toolbox sidebar.
 *
 * WCAG AA fix: white block text needs 4.5:1 contrast against the fill. 6 of
 * the 8 original colours failed (2 of those failed even the 3:1 UI-component
 * floor) — same hue/saturation, luminosity lowered until each cleared 4.5:1.
 * `start`/`robotActions` were already compliant and are unchanged. This does
 * NOT improve colour separability for deuteranopia (measured slightly worse
 * under simulation) — icon + plain-language text remain the required
 * redundant channel (WCAG 1.4.1), not colour alone.
 */
export const blocksColours = {
  /** Logic/Control flow blocks (repeat, when, loop) */
  logicControl: '#837364',
  /** Robot manipulation actions (pick, place, move, gripper) */
  robotActions: '#3153D3',
  /** Human operator actions (pause for human, show message) */
  humanActions: '#AE6300',
  /** User-defined entities: objects, locations, robot procedures */
  objectsPositions: '#00873E',
  /** Conditions and event triggers (sensors, find object, touch, timer) */
  eventsConditions: '#D1481E',
  /** Macro-tasks / predefined sub-routines saved by the user */
  macroTasks: '#0C75DE',
  /** Start block — entry-point of every task program */
  start: '#0F766E',
  /** Empty shadow/placeholder slot ("drop a block here") */
  placeholder: '#757585',
} as const
