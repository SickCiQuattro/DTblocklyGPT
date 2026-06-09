/**
 * shadowPicker/types.ts
 *
 * Type definitions and lookup maps for the shadow-block picker popover.
 *
 * The shadow picker is the floating menu that opens when the user clicks a
 * shadow placeholder block ("+" icon). It lets them select a real block
 * without having to drag from the toolbox.
 *
 * ## Terminology
 *  - **ShadowPopoverType**        — semantic context of the slot being filled.
 *  - **SelectableShadowBlockType** — real block types creatable via the picker.
 *  - **ShadowEntityBlockType**    — block types that map to a ShadowPopoverType.
 *  - **ShadowPickerItem**         — a single row in the picker menu.
 *  - **ShadowPickerPosition**     — screen coordinates for the menu anchor.
 */

// ─── POPOVER CONTEXT TYPES ────────────────────────────────────────────────────

/**
 * Identifies which kind of slot the user is filling when the picker opens.
 * Determines the item list, title, and empty-state copy shown in the menu.
 */
export type ShadowPopoverType =
  | 'object'
  | 'location'
  | 'action'
  | 'trigger'
  | 'sequence'

/**
 * Block types that can be produced by a picker selection.
 * A selection from the picker will create a block of this type and connect
 * it to the shadow slot that was clicked.
 */
export type SelectableShadowBlockType =
  | 'object_block'
  | 'location_block'
  | 'action_block'
  | 'sensor_signal_block'
  | 'find_object_block'
  | 'touch_detect_block'
  | 'gesture_block'
  | 'timer_block'
  | 'logic_and_block'
  | 'logic_or_block'
  | 'logic_not_block'
  | 'pick_block'
  | 'processing_block'
  | 'place_block'
  | 'move_to_block'
  | 'gripper_block'
  | 'wait_block'
  | 'human_action_block'
  | 'notify_action_block'
  | 'repeat_block'
  | 'loop_block'
  | 'repeat_until_block'
  | 'when_block'
  | 'when_otherwise_block'
  | 'macro_task_block'

/**
 * Shadow and real block types that, when clicked, open a specific picker popover.
 * Used as the key set for `SHADOW_POPOVER_BY_BLOCK_TYPE`.
 */
export type ShadowEntityBlockType =
  | 'object_block'
  | 'location_block'
  | 'action_block'
  | 'shadow_object_block'
  | 'shadow_location_block'
  | 'shadow_action_block'
  | 'shadow_trigger_block'
  | 'shadow_sequence_block'
  | 'shadow_start_sequence_block'

// ─── MENU ITEM TYPES ─────────────────────────────────────────────────────────

export interface ShadowPickerItem {
  /** Unique numeric ID used as the React key and for entity lookup. */
  id: number
  /** Human-readable display name shown in the menu row. */
  name: string
  /** Optional description shown below the name in the menu row. */
  description?: string
  /** Optional group header label for visual grouping inside the menu. */
  group?: string
  /** Optional short type hint shown as a badge next to the name. */
  paramHint?: string
  /** Keywords used for fuzzy search within the picker search field. */
  keywords: string[]
  /**
   * The Blockly block type to create when this item is selected.
   * When absent, the picker falls back to `resolveRealBlockTypeFromShadow`.
   */
  blockType?: SelectableShadowBlockType
  /**
   * For items backed by a macro_task, signals that the macro has a published
   * workspace available. Items with `isMacroReady = false` are shown as
   * disabled in the menu (the task exists but is still a draft).
   *
   * Undefined for non-macro items (not applicable).
   */
  isMacroReady?: boolean
}

export interface ShadowPickerPosition {
  top: number
  left: number
}

export interface ShadowEntitySource {
  id: number
  name: string
  group?: string | null
  keywords?: string[] | null
}

// ─── LOOKUP MAPS ─────────────────────────────────────────────────────────────

/**
 * Maps each clickable block type to the corresponding picker popover context.
 * Both real and shadow block types are included so the picker can open
 * regardless of whether the user clicks the shadow or its parent.
 */
export const SHADOW_POPOVER_BY_BLOCK_TYPE: Record<
  ShadowEntityBlockType,
  ShadowPopoverType
> = {
  object_block: 'object',
  shadow_object_block: 'object',
  location_block: 'location',
  shadow_location_block: 'location',
  action_block: 'action',
  shadow_action_block: 'action',
  shadow_trigger_block: 'trigger',
  shadow_sequence_block: 'sequence',
  shadow_start_sequence_block: 'sequence',
}

/** Header text displayed at the top of the picker menu for each context type. */
// MAPPING REFERENCE:
// - location ➔ Select Location (maps to location_block)
// - action ➔ Select Routine (maps to action_block)
export const SHADOW_PICKER_TITLE_BY_TYPE: Record<ShadowPopoverType, string> = {
  object: 'Select Object',
  location: 'Select Location',
  action: 'Select Routine',
  trigger: 'Select Condition',
  sequence: 'Add a step',
}

/** Empty-state copy shown inside the picker when no items match the search. */
export const SHADOW_PICKER_EMPTY_BY_TYPE: Record<ShadowPopoverType, string> = {
  object: 'No objects available.',
  location: 'No locations available.',
  action: 'No routines available.',
  trigger: 'No conditions available.',
  sequence: 'No steps available.',
}


/**
 * Block types that are created directly without needing a data lookup.
 * Entity block types (object, location, action) are NOT direct — they
 * require selecting a specific entity from the list.
 */
export const DIRECT_BLOCK_TYPES = new Set<SelectableShadowBlockType>([
  'sensor_signal_block',
  'find_object_block',
  'touch_detect_block',
  'gesture_block',
  'timer_block',
  'logic_and_block',
  'logic_or_block',
  'logic_not_block',
])
