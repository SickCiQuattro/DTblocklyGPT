/**
 * icons.ts
 *
 * SVG icon Data URIs and Blockly `field_image` configuration helpers used
 * across all block definitions. Every icon is constructed from raw Lucide
 * SVG inner markup so the bundle stays free of external image assets.
 *
 * Exports:
 *  - `createLucideIconURI` — generic helper to turn SVG markup into a Data URI
 *  - Named `*_ICON_URI` constants for each icon used in a block definition
 *  - `iconConfig` / `plusFieldConfig` family — factories for Blockly field_image objects
 *  - `SHADOW_ICON_URIS` — base and lit variants for the shadow-block "+" indicator
 */

import { blocksColours } from './palette'

// ─── DATA URI FACTORY ────────────────────────────────────────────────────────

/**
 * Generates a Blockly-compatible Data URI from raw Lucide-like SVG inner markup.
 * Paste the inner tags (<path>, <circle>, <rect>, …) directly from the icon source.
 *
 * @param svgContent Inner SVG nodes as a string (no outer <svg> wrapper needed).
 * @param color      Stroke colour applied to all paths. Defaults to white.
 * @returns          A `data:image/svg+xml,…` URI safe to use in `field_image`.
 */
export const createLucideIconURI = (
  svgContent: string,
  color: string = 'white',
): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgContent}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

// ─── NAMED ICON URIs (white stroke, for use inside coloured blocks) ───────────

/** Repeat2 icon - used on task flow blocks. */
export const REPEAT2_ICON_URI = createLucideIconURI(
  '<path d="m2 9 3-3 3 3"/><path d="M13 18H7a2 2 0 0 1-2-2V6"/><path d="m22 15-3 3-3-3"/><path d="M11 6h6a2 2 0 0 1 2 2v10"/>',
)

/** Robot / Bot icon — used on all robot-action blocks. */
export const BOT_ICON_URI = createLucideIconURI(
  '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
)

/** Person / User icon — used on human-step blocks. */
export const USER_ICON_URI = createLucideIconURI(
  '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
)

/** Tag icon — used on object-entity blocks. */
export const TAG_ICON_URI = createLucideIconURI(
  '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
)

/** Map-pin icon — used on location/destination blocks. */
export const MAP_PIN_ICON_URI = createLucideIconURI(
  '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
)

/** Wrench icon — used on action/procedure blocks. */
export const WRENCH_ICON_URI = createLucideIconURI(
  '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>',
)

/** Workflow icon — used on macro-task blocks. */
export const WORKFLOW_ICON_URI = createLucideIconURI(
  '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
)

/** Scan/Eye icon — used on all condition/sensor blocks. */
export const SCAN_EYE_ICON_URI = createLucideIconURI(
  '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="1"/><path d="M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0"/>',
)

/** Flag icon — used on the when_start entry-point block. */
export const FLAG_ICON_URI = createLucideIconURI(
  '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
)

// ─── SHADOW "+" ICON URIs ─────────────────────────────────────────────────────
// Shadow blocks show a circular "+", rendered in different colours depending
// on the connection type (entity/workspace, trigger/condition, start, sequence).
// Each variant has a `base` (dim, before interaction) and `lit` (bright, on hover/drag).

const CIRCLE_PLUS_SVG =
  '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>'

const CIRCLE_PLUS_ICON_URI_BASE = createLucideIconURI(
  CIRCLE_PLUS_SVG,
  'rgba(1, 189, 86, 0.45)',
)
const CIRCLE_PLUS_ICON_URI_LIT = createLucideIconURI(
  CIRCLE_PLUS_SVG,
  blocksColours.objectsPositions,
)

const CIRCLE_PLUS_TRIGGER_ICON_URI_BASE = createLucideIconURI(
  CIRCLE_PLUS_SVG,
  'rgba(225, 89, 48, 0.45)',
)
const CIRCLE_PLUS_TRIGGER_ICON_URI_LIT = createLucideIconURI(
  CIRCLE_PLUS_SVG,
  blocksColours.eventsConditions,
)

const CIRCLE_PLUS_SEQUENCE_ICON_URI_BASE = createLucideIconURI(
  CIRCLE_PLUS_SVG,
  'rgba(128, 138, 157, 0.45)',
)
const CIRCLE_PLUS_SEQUENCE_ICON_URI_LIT = createLucideIconURI(
  CIRCLE_PLUS_SVG,
  'rgba(128, 138, 157, 1)',
)

const CIRCLE_PLUS_START_ICON_URI_BASE = createLucideIconURI(
  CIRCLE_PLUS_SVG,
  'rgba(15, 118, 110, 0.45)',
)
const CIRCLE_PLUS_START_ICON_URI_LIT = createLucideIconURI(
  CIRCLE_PLUS_SVG,
  blocksColours.start,
)

/**
 * Base and lit Data URIs for the shadow-block "+" indicator icon,
 * keyed by the connection context in which the shadow block appears.
 *
 * - `workspace` — entity slot (object / location / action)
 * - `trigger`   — Boolean condition input
 * - `sequence`  — next/previous statement connection
 * - `start`     — the special slot directly below the when_start block
 */
export const SHADOW_ICON_URIS = {
  workspace: { base: CIRCLE_PLUS_ICON_URI_BASE, lit: CIRCLE_PLUS_ICON_URI_LIT },
  trigger: {
    base: CIRCLE_PLUS_TRIGGER_ICON_URI_BASE,
    lit: CIRCLE_PLUS_TRIGGER_ICON_URI_LIT,
  },
  sequence: {
    base: CIRCLE_PLUS_SEQUENCE_ICON_URI_BASE,
    lit: CIRCLE_PLUS_SEQUENCE_ICON_URI_LIT,
  },
  start: {
    base: CIRCLE_PLUS_START_ICON_URI_BASE,
    lit: CIRCLE_PLUS_START_ICON_URI_LIT,
  },
} as const

// ─── BLOCKLY field_image CONFIG HELPERS ───────────────────────────────────────

/**
 * Builds a Blockly `field_image` field descriptor from a Data URI.
 *
 * @param src    Image Data URI (use the `*_ICON_URI` constants above).
 * @param alt    Accessible alt text for screen readers.
 * @param width  Rendered width in pixels. Defaults to 18.
 * @param height Rendered height in pixels. Defaults to 18.
 */
export const iconConfig = (
  src: string,
  alt: string,
  width = 18,
  height = 18,
) => ({
  type: 'field_image',
  src,
  width,
  height,
  alt,
  flipRtl: false,
})

/** "+" indicator for entity (object/location/action) shadow slots. */
export const plusFieldConfig = () =>
  iconConfig(CIRCLE_PLUS_ICON_URI_BASE, '+', 14, 14)

/** "+" indicator for condition/trigger shadow slots. */
export const triggerPlusFieldConfig = () =>
  iconConfig(CIRCLE_PLUS_TRIGGER_ICON_URI_BASE, '+', 14, 14)

/** "+" indicator for sequence (next-step) shadow slots. */
export const sequencePlusFieldConfig = () =>
  iconConfig(CIRCLE_PLUS_SEQUENCE_ICON_URI_BASE, '+', 14, 14)

/** "+" indicator for the first-step slot directly below the start block. */
export const startPlusFieldConfig = () =>
  iconConfig(CIRCLE_PLUS_START_ICON_URI_BASE, '+', 14, 14)
