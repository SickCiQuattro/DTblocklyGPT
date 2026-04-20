import * as Blockly from 'blockly/core'
import ModernTheme from '@blockly/theme-modern'

const DTheme = Blockly.Theme.defineTheme('DTheme', {
  name: 'DTheme',
  base: ModernTheme,
  componentStyles: {
    workspaceBackgroundColour: '#F5F5F5',
    scrollbarColour: '#D9D9D9',
    scrollbarOpacity: 0.8,
  },
})

/** Shared config for the editable Blockly workspace. */
export const INTERACTIVE_WORKSPACE_CONFIG: Blockly.BlocklyOptions = {
  renderer: 'thrasos',
  readOnly: false,
  trashcan: false,
  media: '/blocklyMedia',
  move: { scrollbars: true, drag: true, wheel: true },
  zoom: { startScale: 1.5, controls: false, wheel: true, pinch: true },
  grid: {
    spacing: 20,
    length: 2,
    colour: '#D4D4D4',
    snap: true,
  },
  sounds: false,
  collapse: true,
  comments: false,
  theme: DTheme,
}

/** Shared config for full-size read-only viewers (e.g., modal previews). */
export const READONLY_WORKSPACE_CONFIG: Blockly.BlocklyOptions = {
  renderer: 'thrasos',
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
  renderer: 'thrasos',
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
    colour: '#transparent',
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
    colour: '#D4D4D4',
    snap: false,
  },
  sounds: false,
  collapse: false,
  comments: false,
  theme: DTheme,
}
