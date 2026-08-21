/**
 * shadowPicker/catalog.ts
 *
 * Item catalog for the shadow-block picker popover.
 *
 * Contains all static item lists (trigger conditions, sequence steps) and the
 * factory functions that build dynamic item lists from runtime data
 * (objects, locations, actions, macro tasks).
 *
 * Also exports pure helpers used during item selection to decide which real
 * Blockly block type to create and what shadow inputs to pre-populate.
 */

import { TaskType } from 'pages/tasks/types'
import { slate } from 'themes/theme'
import { UI_TEXT } from 'constants/uiVocabulary'

import { normalizeKeywords } from '../../utils/keywords'
import { blocksColours } from '../../blocks/palette'

import {
  DIRECT_BLOCK_TYPES,
  type SelectableShadowBlockType,
  type ShadowEntitySource,
  type ShadowPickerItem,
} from './types'

// ─── STATIC TRIGGER (CONDITION) ITEMS ────────────────────────────────────────

/**
 * Fixed list of condition/trigger blocks shown in the picker when the user
 * clicks a `shadow_trigger_block` slot (Boolean input inside when/repeat-until).
 */
export const TRIGGER_PICKER_ITEMS: ShadowPickerItem[] = [
  {
    id: 2,
    name: 'Object detected',
    description: 'Camera checks if a specific object is visible.',
    group: 'Conditions',
    paramHint: 'object',
    keywords: ['object', 'vision', 'camera', 'find'],
    blockType: 'find_object_block',
  },
  {
    id: 4,
    name: 'Gesture detected',
    description: 'Worker shows a specific hand gesture to the camera.',
    group: 'Conditions',
    paramHint: 'gesture type',
    keywords: ['gesture', 'camera', 'hand'],
    blockType: 'gesture_block',
  },
  {
    id: 9,
    name: 'Voice command',
    description: 'Operator says a specific word (yes, no, done, proceed).',
    group: 'Conditions',
    paramHint: 'word',
    keywords: ['voice', 'say', 'word', 'speak', 'speech'],
    blockType: 'voice_command_block',
  },
  {
    id: 10,
    name: 'Operator confirms',
    description:
      'Waits until the operator presses Confirm in the robot panel — no camera or microphone needed.',
    group: 'Conditions',
    keywords: ['confirm', 'press', 'button', 'manual', 'operator'],
    blockType: 'human_feedback_block',
  },
  // ── Hidden 2026-06-30 per relatrice feedback (kept for re-enable, not removed):
  //    'Time passed' (timer_block) + logic AND/OR/NOT. Block definitions, parser
  //    and backend enums remain intact — only the picker rows are suppressed.
  // {
  //   id: 5,
  //   name: 'Time passed',
  //   description: 'Becomes true after a set number of seconds.',
  //   group: 'Conditions',
  //   paramHint: 'seconds',
  //   keywords: ['timer', 'seconds', 'delay', 'time'],
  //   blockType: 'timer_block',
  // },
  // {
  //   id: 6,
  //   name: 'AND',
  //   description: 'Both conditions must be true at the same time.',
  //   group: 'Logic',
  //   paramHint: 'A  +  B',
  //   keywords: ['and', 'both', 'combine'],
  //   blockType: 'logic_and_block',
  // },
  // {
  //   id: 7,
  //   name: 'OR',
  //   description: 'At least one of the two conditions must be true.',
  //   group: 'Logic',
  //   paramHint: 'A  or  B',
  //   keywords: ['or', 'either', 'combine'],
  //   blockType: 'logic_or_block',
  // },
  // {
  //   id: 8,
  //   name: 'NOT',
  //   description: 'Reverses the result — true becomes false.',
  //   group: 'Logic',
  //   paramHint: 'reverses',
  //   keywords: ['not', 'negate', 'invert', 'opposite'],
  //   blockType: 'logic_not_block',
  // },
]

// ─── SEQUENCE ITEMS ───────────────────────────────────────────────────────────

/**
 * Build the full list of items shown when the user clicks a sequence shadow slot.
 *
 * Static robot/human/flow items are combined with one dynamic item per available
 * macro task, filtered to `status` `'published'` or `'published_with_draft'` —
 * meaning a stable `published_workspace` exists that `explodeMacro` can expand.
 *
 * Tasks still in `'draft'` state are filtered out entirely: they have no
 * published workspace and cannot be used in other tasks.
 *
 * @param macros Available macro tasks (current task already excluded upstream).
 */
export const buildSequencePickerItems = (
  macros: TaskType[],
): ShadowPickerItem[] => {
  // Order mirrors the toolbox: Task Flow → Robot Actions → Operator.
  const staticItems: ShadowPickerItem[] = [
    {
      id: -9,
      name: 'Repeat times',
      description: 'Repeat a sequence a fixed number of times',
      keywords: ['repeat', 'loop', 'times', 'count'],
      blockType: 'repeat_block',
      group: 'Task Flow',
    },
    {
      id: -11,
      name: 'Repeat until',
      description: 'Repeat until a condition is met',
      keywords: ['repeat', 'until', 'condition', 'while'],
      blockType: 'repeat_until_block',
      group: 'Task Flow',
    },
    {
      id: -12,
      name: 'When',
      description: 'Execute steps only when a condition is true',
      keywords: ['when', 'if', 'condition'],
      blockType: 'when_block',
      group: 'Task Flow',
    },
    {
      id: -13,
      name: 'When / Otherwise',
      description: 'Execute different steps based on a condition',
      keywords: ['when', 'otherwise', 'if', 'else'],
      blockType: 'when_otherwise_block',
      group: 'Task Flow',
    },
    {
      id: -1,
      name: 'Pick up',
      description: 'Pick up an object with the robot arm',
      keywords: ['pick', 'grab', 'grasp', 'object'],
      blockType: 'pick_block',
      group: 'Robot Actions',
    },
    {
      id: -2,
      // MAPPING REFERENCE:
      // - User-facing block name: 'Execute skill'
      // - Internally creates a 'processing_block' (which maps to /actions DB records)
      name: 'Execute skill',
      description: 'Run a pre-configured skill',
      keywords: ['run', 'skill', 'routine', 'execute', 'perform'],
      blockType: 'processing_block',
      group: 'Robot Actions',
    },
    {
      id: -3,
      name: 'Place at',
      description: 'Place the held object at a destination',
      keywords: ['place', 'put', 'deposit', 'location'],
      blockType: 'place_block',
      group: 'Robot Actions',
    },
    {
      id: -4,
      name: 'Move to',
      description: 'Move the robot to a specific location',
      keywords: ['move', 'go', 'navigate', 'location'],
      blockType: 'move_to_block',
      group: 'Robot Actions',
    },
    {
      id: -5,
      name: 'Open Gripper',
      description: 'Open the robot gripper',
      keywords: ['gripper', 'open', 'release', 'hand'],
      blockType: 'open_gripper_block',
      group: 'Robot Actions',
    },
    {
      id: -10,
      name: 'Close Gripper',
      description: 'Close the robot gripper',
      keywords: ['gripper', 'close', 'grip', 'hand'],
      blockType: 'close_gripper_block',
      group: 'Robot Actions',
    },
    {
      id: -6,
      name: 'Wait',
      description: 'Pause execution for a set amount of time',
      keywords: ['wait', 'pause', 'delay', 'seconds'],
      blockType: 'wait_block',
      group: 'Robot Actions',
    },
    {
      id: -7,
      name: 'Pause and show',
      description: 'Pause and prompt a human operator to act',
      keywords: ['human', 'pause', 'operator', 'show'],
      blockType: 'human_action_block',
      group: 'Human Actions',
    },
    {
      id: -8,
      name: 'Show message',
      description: 'Display a notification and continue',
      keywords: ['notify', 'message', 'info', 'continue'],
      blockType: 'notify_action_block',
      group: 'Human Actions',
    },
  ]

  const macroItems: ShadowPickerItem[] = macros
    .filter(
      (macro) =>
        macro.status === 'published' || macro.status === 'published_with_draft',
    )
    .map((macro) => {
      const displayName = macro.name?.trim() || `Task ${macro.id}`
      return {
        id: macro.id,
        name: displayName,
        description: macro.description?.trim() || undefined,
        keywords: ['task', 'macro', macro.name?.toLowerCase() ?? ''],
        blockType: 'macro_task_block' as const,
        // Same two keys the toolbox pill sets (CustomToolbox.tsx) — `name` is
        // the visible label, `data` is the actual reference to the task. Keep
        // them identical: a block inserted from the search dialog and one
        // dragged from the toolbox must be the same block.
        fields: { name: displayName },
        data: JSON.stringify({ id: macro.id, name: displayName }),
        // MAPPING REFERENCE:
        // - Category key: 'macro-tasks' ➔ User-facing picker group: UI_TEXT.savedTasks
        group: UI_TEXT.savedTasks,
      }
    })

  return [...staticItems, ...macroItems]
}

// ─── ENTITY ITEM BUILDERS ─────────────────────────────────────────────────────

/**
 * Build picker items from an array of backend entity records.
 * Used for object, location, and action slots.
 *
 * @param entities       Array of backend entity records.
 * @param fallbackPrefix Label prefix used when an entity has no name.
 * @param group          Group header label for the menu section.
 */
export const buildShadowPickerItems = (
  entities: ShadowEntitySource[],
  // MAPPING REFERENCE:
  // - fallbackPrefix: 'Skill' (user-facing) maps internally to ActionListType (dataActions)
  fallbackPrefix: 'Object' | 'Location' | 'Skill',
  group: string,
): ShadowPickerItem[] =>
  entities.map((entity) => ({
    id: entity.id,
    name: entity.name?.trim() || `${fallbackPrefix} ${entity.id}`,
    group: entity.group?.trim() || group,
    keywords: normalizeKeywords(
      Array.isArray(entity.keywords) ? entity.keywords : [],
    ),
  }))

// ─── FILTERING ────────────────────────────────────────────────────────────────

/**
 * Filter picker items by matching the search query against name and keywords.
 * Returns the full list unchanged when `query` is empty.
 *
 * @param items Raw item array to filter.
 * @param query User-typed search string (not yet lowercased).
 */
export const filterShadowItems = (
  items: ShadowPickerItem[],
  query: string,
): ShadowPickerItem[] => {
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) {
    return items
  }

  return items.filter((item) => {
    if (item.name.toLowerCase().includes(normalizedQuery)) {
      return true
    }

    return item.keywords.some((keyword) =>
      keyword.toLowerCase().includes(normalizedQuery),
    )
  })
}

// ─── BLOCK RESOLUTION HELPERS ─────────────────────────────────────────────────

/**
 * Determine which real block type to create when an item is selected from the
 * picker for a given shadow block type.
 *
 * - `shadow_trigger_block` maps to `gesture_block` as the default.
 * - `shadow_object/location/action_block` strip the `shadow_` prefix.
 * - Any block type already in `DIRECT_BLOCK_TYPES` is returned as-is.
 *
 * @param blockType The Blockly type of the shadow block that was clicked.
 * @returns         The corresponding real block type, or `null` if unrecognised.
 */
export const resolveRealBlockTypeFromShadow = (
  blockType: string,
): SelectableShadowBlockType | null => {
  if (blockType === 'shadow_trigger_block') {
    return 'gesture_block'
  }

  if (blockType.startsWith('shadow_')) {
    const resolvedType = blockType.replace('shadow_', '')
    if (
      resolvedType === 'object_block' ||
      resolvedType === 'location_block' ||
      resolvedType === 'action_block'
    ) {
      return resolvedType
    }
  }

  if (DIRECT_BLOCK_TYPES.has(blockType as SelectableShadowBlockType)) {
    return blockType as SelectableShadowBlockType
  }

  return null
}

/**
 * Return the default shadow inputs for blocks that have sub-slots needing
 * placeholder blocks. Used when building the block state on picker selection.
 *
 * For example, `logic_and_block` needs two `shadow_trigger_block` inputs pre-filled.
 *
 * @param blockType The block type being created.
 * @returns         A partial Blockly state `inputs` object, or `{}` if none needed.
 */
export const getBlockInputState = (
  blockType: SelectableShadowBlockType,
): Record<string, unknown> => {
  const shadowTrigger = {
    shadow: {
      type: 'shadow_trigger_block',
      fields: { name: 'Select Condition' },
    },
  }
  const shadowObject = {
    shadow: {
      type: 'shadow_object_block',
      fields: { name: 'Select Object' },
    },
  }

  switch (blockType) {
    case 'logic_and_block':
    case 'logic_or_block':
      return { inputs: { A: shadowTrigger, B: shadowTrigger } }
    case 'logic_not_block':
      return { inputs: { BOOL: shadowTrigger } }
    case 'find_object_block':
      return { inputs: { OBJECT: shadowObject } }
    default:
      return {}
  }
}

/**
 * Map a group label to its dot-indicator colour in the picker menu.
 * The dot is the small coloured circle shown to the left of each item row.
 *
 * @param group Group header label string.
 * @returns     Hex colour string for the dot.
 */
export const getDotColour = (group: string): string => {
  switch (group) {
    case 'Objects':
    case 'Locations':
    case 'Skills':
      return blocksColours.objectsPositions
    case 'Conditions':
    case 'Logic':
      return blocksColours.eventsConditions
    case 'Robot Actions':
      return blocksColours.robotActions
    case 'Human Actions':
      return blocksColours.humanActions
    case 'Task Flow':
      return blocksColours.logicControl
    case UI_TEXT.savedTasks:
      return blocksColours.macroTasks
    default:
      return slate[400]
  }
}

/**
 * Resolve which `ShadowPopoverType` to open for a given block type string.
 * Returns `null` for block types that should not open a picker.
 *
 * @param blockType The Blockly type of the clicked block.
 */
export const resolveShadowPopoverType = (
  blockType: string,
): import('./types').ShadowPopoverType | null => {
  const map = {
    object_block: 'object',
    shadow_object_block: 'object',
    location_block: 'location',
    shadow_location_block: 'location',
    action_block: 'action',
    shadow_action_block: 'action',
    shadow_trigger_block: 'trigger',
    shadow_sequence_block: 'sequence',
    shadow_start_sequence_block: 'sequence',
  } as const

  return (
    (map as Record<string, import('./types').ShadowPopoverType>)[blockType] ??
    null
  )
}
