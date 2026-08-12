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
 *
 * ── Measured ratios, against WHITE ────────────────────────────────────────
 * Block text is white under the Classic theme (workspace/workspaceConfig.ts),
 * so white is the reference — not the workspace background.
 *
 * Every value below is recorded next to its colour because SIX of the eight
 * sit within 0.13 of the 4.5:1 threshold, and `eventsConditions` clears it by
 * 0.01. A single luminosity step "to make it a bit nicer" drops one of these
 * below AA, and nothing in the build would catch it: there is no automated
 * contrast check. Change a value here and recompute its ratio in the same
 * commit, or the conformance claim in the thesis stops being true silently.
 */
export const blocksColours = {
  /** Logic/Control flow blocks (repeat, when, loop) — 4.56:1 (+0.06) */
  logicControl: '#837364',
  /** Robot manipulation actions (pick, place, move, gripper) — 6.35:1 (+1.85) */
  robotActions: '#3153D3',
  /** Human operator actions (pause for human, show message) — 4.58:1 (+0.08) */
  humanActions: '#AE6300',
  /** User-defined entities: objects, locations, robot procedures — 4.63:1 (+0.13) */
  objectsPositions: '#00873E',
  /** Conditions and event triggers (find object, gesture, voice) — 4.51:1 (+0.01) */
  eventsConditions: '#D1481E',
  /** Macro-tasks / predefined sub-routines saved by the user — 4.55:1 (+0.05) */
  macroTasks: '#0C75DE',
  /** Start block — entry-point of every task program — 5.47:1 (+0.97) */
  start: '#0F766E',
  /** Empty shadow/placeholder slot — 4.53:1 (+0.03). Not a toolbox category. */
  placeholder: '#757585',
} as const
