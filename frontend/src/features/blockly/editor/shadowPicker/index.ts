/**
 * shadowPicker/index.ts
 *
 * Barrel export for the shadow-block picker sub-module.
 */

export { ShadowPickerMenu } from './ShadowPickerMenu'
export { useShadowPicker, setShadowIconState } from './useShadowPicker'
export { resolveShadowPopoverType } from './catalog'
export type { ShadowPickerAPI } from './useShadowPicker'
export type {
  ShadowPopoverType,
  ShadowPickerItem,
  ShadowPickerPosition,
  ShadowEntityBlockType,
  SelectableShadowBlockType,
} from './types'
