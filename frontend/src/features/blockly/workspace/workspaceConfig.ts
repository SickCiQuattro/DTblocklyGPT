/**
 * workspaceConfig.ts
 *
 * Centralised Blockly workspace configuration objects used across the editor,
 * viewer, and preview workspaces.
 *
 * Exports four named configurations:
 *  - `INTERACTIVE_WORKSPACE_CONFIG` — full-featured editable workspace.
 *  - `READONLY_WORKSPACE_CONFIG`    — non-editable viewer (e.g. task review page).
 *  - `MODAL_VIEWER_CONFIG`          — compact read-only workspace for dialogs.
 *  - `PREVIEW_WORKSPACE_CONFIG`     — minimal workspace for tooltip block previews.
 */
import * as Blockly from 'blockly/core'

import { brand, canvasNeutral, editorState } from 'themes/theme'

import './customRender'

// Classic base, not @blockly/theme-modern — ModernTheme is Classic plus
// block/category styles this app never references (every block sets an
// explicit `colour:`, the toolbox is custom React). Classic renders
// identically here and avoids a blockly@^12-pinned plugin dependency.
const DTheme = Blockly.Theme.defineTheme('DTheme', {
  name: 'DTheme',
  base: Blockly.Themes.Classic,
  componentStyles: {
    workspaceBackgroundColour: canvasNeutral.bg,
    scrollbarColour: canvasNeutral.scrollbar,
    scrollbarOpacity: 0.8,

    // Selection and the keyboard cursor are amber, never indigo: indigo is
    // reserved for the block the robot is executing (see editorState in
    // themes/theme). insertionMarkerColour stays brand indigo — it is the
    // drop preview during a drag, neither a selection nor an execution state.
    selectedGlowColour: editorState.selection,
    selectedGlowOpacity: 0.4,
    insertionMarkerColour: brand.primary,
    insertionMarkerOpacity: 0.25,
    cursorColour: editorState.selection,
    markerColour: editorState.selection,
  },
  // Match the app font instead of Blockly's default sans-serif.
  fontStyle: {
    family: 'Geist, Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  },
})

/** Shared config for the editable Blockly workspace. */
export const INTERACTIVE_WORKSPACE_CONFIG: Blockly.BlocklyOptions = {
  renderer: 'thrasos_boolean',
  readOnly: false,
  trashcan: false,
  media: '/blocklyMedia',
  move: { scrollbars: true, drag: true, wheel: true },
  zoom: { startScale: 1.5, controls: false, wheel: true, pinch: true },
  grid: {
    spacing: 20,
    length: 2,
    colour: canvasNeutral.grid,
    snap: true,
  },
  sounds: false,
  collapse: true,
  comments: false,
  theme: DTheme,
}

/** Shared config for full-size read-only viewers (e.g., modal previews). */
export const READONLY_WORKSPACE_CONFIG: Blockly.BlocklyOptions = {
  renderer: 'thrasos_boolean',
  readOnly: true,
  trashcan: false,
  media: '/blocklyMedia',
  move: { drag: true, wheel: true, scrollbars: true },
  zoom: {
    controls: true,
    wheel: true,
    pinch: true,
    startScale: 0.9,
    maxScale: 2,
    minScale: 0.3,
    scaleSpeed: 1.2,
  },
  theme: DTheme,
}

/** Shared config for compact tooltip previews backed by a singleton workspace. */
export const PREVIEW_WORKSPACE_CONFIG: Blockly.BlocklyOptions = {
  renderer: 'thrasos_boolean',
  readOnly: true,
  trashcan: false,
  media: '/blocklyMedia',
  move: { drag: false, wheel: false, scrollbars: false },
  zoom: {
    controls: false,
    wheel: false,
    pinch: false,
    startScale: 1,
    maxScale: 2,
    minScale: 0.3,
    scaleSpeed: 1,
  },
  grid: {
    spacing: 0,
    length: 0,
    colour: 'transparent',
    snap: false,
  },
  sounds: false,
  collapse: false,
  comments: false,
  theme: DTheme,
}

/** Shared config for macro modal viewer with custom controls overlay. */
export const MODAL_VIEWER_CONFIG: Blockly.BlocklyOptions = {
  ...READONLY_WORKSPACE_CONFIG,
  move: { drag: true, wheel: true, scrollbars: true },
  zoom: {
    controls: false,
    wheel: true,
    pinch: true,
    startScale: 1.2,
    maxScale: 2,
    minScale: 0.3,
    scaleSpeed: 1.2,
  },
  grid: {
    spacing: 18,
    length: 2,
    colour: canvasNeutral.grid,
    snap: false,
  },
  sounds: false,
  collapse: false,
  comments: false,
  theme: DTheme,
}
