/**
 * blocks/index.ts
 *
 * Barrel export for the blocks sub-module.
 * Import from this path for the colour palette, block descriptions,
 * and the shadow-icon URI map.
 *
 * Note: importing this barrel does NOT register any Blockly block types.
 * To register all block types, import `./definitions` (or any file that
 * transitively imports it) before injecting a Blockly workspace.
 */

export { blocksColours } from './palette'
export { SHADOW_ICON_URIS } from './icons'
export { blockDescriptionsByType } from './blockTextDictionary'
