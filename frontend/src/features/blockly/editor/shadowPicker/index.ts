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
export {
  SHADOW_POPOVER_BY_BLOCK_TYPE,
  SHADOW_PICKER_TITLE_BY_TYPE,
  SHADOW_PICKER_EMPTY_BY_TYPE,
  DIRECT_BLOCK_TYPES,
} from './types'
