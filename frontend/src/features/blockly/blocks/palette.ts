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
 */
export const blocksColours = {
  /** Logic/Control flow blocks (repeat, when, loop) */
  logicControl: '#978676',
  /** Robot manipulation actions (pick, place, move, gripper) */
  robotActions: '#3153D3',
  /** Human operator actions (pause for human, show message) */
  humanActions: '#F58C00',
  /** User-defined entities: objects, locations, robot procedures */
  objectsPositions: '#00BD56',
  /** Conditions and event triggers (sensors, find object, touch, timer) */
  eventsConditions: '#E15930',
  /** Macro-tasks / predefined sub-routines saved by the user */
  macroTasks: '#3B97F4',
  /** Start block — entry-point of every task program */
  start: '#0F766E',
} as const
