/**
 * shadowPicker/useShadowPicker.ts
 *
 * React hook that manages all state and logic for the shadow-block picker popover.
 *
 * Responsibilities:
 *  - Tracks which shadow block is "active" (targeted by the picker).
 *  - Computes the item list for the current popover context.
 *  - Handles the search query and filters items on the fly.
 *  - Groups filtered items by their `group` field for display.
 *  - On item selection, creates the appropriate real Blockly block and connects
 *    it to the slot that was originally clicked.
 *  - Exposes `open()` and `close()` so the workspace event listener can
 *    trigger the picker from outside React.
 *
 * The hook intentionally keeps **all** shadow-picker concerns in one place so
 * that `BlocklyEditor` can simply spread the returned props onto `ShadowPickerMenu`.
 */

import * as Blockly from 'blockly/core'
import { useCallback, useMemo, useRef, useState } from 'react'

import { ActionListType } from 'pages/actions/types'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { TaskType } from 'pages/tasks/types'
import { BlockState as State } from 'utils/blocklyTypes'

import { toKeywordsCsvOrNull } from '../../utils/keywords'
import { SHADOW_ICON_URIS } from '../../blocks/icons'

import {
  buildSequencePickerItems,
  buildShadowPickerItems,
  filterShadowItems,
  getBlockInputState,
  resolveRealBlockTypeFromShadow,
  TRIGGER_PICKER_ITEMS,
} from './catalog'
import {
  DIRECT_BLOCK_TYPES,
  type SelectableShadowBlockType,
  type ShadowPickerItem,
  type ShadowPickerPosition,
  type ShadowPopoverType,
} from './types'

// ─── SHADOW ICON HELPERS ──────────────────────────────────────────────────────

/**
 * Resolve the icon variant (workspace / trigger / sequence / start) for a shadow
 * block by inspecting the CSS classes that the `shadow_placeholder_extension`
 * applied during `initSvg`.
 */
const resolveShadowIconType = (
  classList: DOMTokenList | undefined,
): keyof typeof SHADOW_ICON_URIS => {
  if (classList?.contains('custom-dashed-shadow-trigger')) return 'trigger'
  if (classList?.contains('custom-dashed-shadow-sequence')) return 'sequence'
  if (classList?.contains('custom-dashed-shadow-start')) return 'start'
  return 'workspace'
}

/**
 * Find the `<image>` SVG element inside a shadow block's SVG group.
 * This element carries the "+" icon Data URI that we swap on hover / selection.
 */
const getShadowPlusImageEl = (
  block: Blockly.BlockSvg,
): SVGImageElement | null => {
  const svgRoot = block.getSvgRoot?.()
  if (!svgRoot) return null
  return svgRoot.querySelector<SVGImageElement>('image') ?? null
}

/**
 * Switch the shadow block's "+" icon between the dim `base` and the bright `lit`
 * variant to give visual feedback when the picker is open or a drag is compatible.
 */
export const setShadowIconState = (
  block: Blockly.BlockSvg,
  lit: boolean,
): void => {
  const type = resolveShadowIconType(block.getSvgRoot?.()?.classList)
  const uri = lit ? SHADOW_ICON_URIS[type].lit : SHADOW_ICON_URIS[type].base
  getShadowPlusImageEl(block)?.setAttribute('href', uri)
}

// ─── HOOK ─────────────────────────────────────────────────────────────────────

interface UseShadowPickerParams {
  /** Ref to the active Blockly workspace (may be null when unmounted). */
  workspaceRef: React.RefObject<Blockly.WorkspaceSvg | null>
  /** Backend objects for the "object" picker context. */
  dataObjects: ObjectListType[]
  /** Backend locations for the "location" picker context. */
  dataLocations: LocationListType[]
  /** Backend actions for the "action" picker context. */
  dataActions: ActionListType[]
  /** Available macro tasks for the "sequence" picker context (current task excluded). */
  availableMacros: TaskType[]
}

/**
 * All values returned by `useShadowPicker` for use by `BlocklyEditor` and
 * `ShadowPickerMenu`.
 */
export interface ShadowPickerAPI {
  // ── State (read by ShadowPickerMenu) ──
  isOpen: boolean
  position: ShadowPickerPosition | null
  popoverType: ShadowPopoverType | null
  targetBlockId: string | null
  searchQuery: string
  filteredItems: ShadowPickerItem[]
  groupedItems: Record<string, ShadowPickerItem[]>
  /** Ref kept in sync with `targetBlockId` for use outside React render cycles. */
  targetBlockIdRef: React.RefObject<string | null>

  // ── Actions ──
  /**
   * Open the picker anchored to the given block.
   * Should be called from the Blockly workspace event listener when a shadow
   * block click is detected.
   */
  open: (
    blockId: string,
    popoverType: ShadowPopoverType,
    position: ShadowPickerPosition,
  ) => void
  /** Close the picker and reset all state. */
  close: () => void
  /** Handle item selection: create the real block and connect it to the slot. */
  selectItem: (item: ShadowPickerItem) => void
  /** Update the search query (bound to the picker's search input). */
  setSearchQuery: (q: string) => void
}

/**
 * Custom hook that owns the complete shadow picker lifecycle.
 *
 * @returns A `ShadowPickerAPI` object to spread into `ShadowPickerMenu` props.
 */
export const useShadowPicker = ({
  workspaceRef,
  dataObjects,
  dataLocations,
  dataActions,
  availableMacros,
}: UseShadowPickerParams): ShadowPickerAPI => {
  const [position, setPosition] = useState<ShadowPickerPosition | null>(null)
  const [popoverType, setPopoverType] = useState<ShadowPopoverType | null>(null)
  const [targetBlockId, setTargetBlockIdState] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  /** Ref mirror of `targetBlockId` so the close handler can read it synchronously. */
  const targetBlockIdRef = useRef<string | null>(null)

  const setTargetBlockId = useCallback((id: string | null) => {
    targetBlockIdRef.current = id
    setTargetBlockIdState(id)
  }, [])

  // ── Full item list for the current context ─────────────────────────────────

  // MAPPING REFERENCE:
  // - dataObjects ➔ 'Objects'
  // - dataLocations (LocationListType) ➔ 'Locations'
  // - dataActions (ActionListType) ➔ 'Routines'
  const selectedItems = useMemo<ShadowPickerItem[]>(() => {
    switch (popoverType) {
      case 'object':
        return buildShadowPickerItems(dataObjects, 'Object', 'Objects')
      case 'location':
        return buildShadowPickerItems(dataLocations, 'Location', 'Locations')
      case 'action':
        return buildShadowPickerItems(dataActions, 'Routine', 'Routines')
      case 'trigger':
        return TRIGGER_PICKER_ITEMS
      case 'sequence':
        return buildSequencePickerItems(availableMacros)
      default:
        return []
    }
  }, [dataActions, dataLocations, dataObjects, popoverType, availableMacros])

  /** Items filtered by the current search query. */
  const filteredItems = useMemo(
    () => filterShadowItems(selectedItems, searchQuery),
    [selectedItems, searchQuery],
  )

  /** Filtered items grouped by their `group` field for section headers. */
  const groupedItems = useMemo(
    () =>
      filteredItems.reduce<Record<string, ShadowPickerItem[]>>((acc, item) => {
        const group = item.group ?? 'Other'
        ;(acc[group] ??= []).push(item)
        return acc
      }, {}),
    [filteredItems],
  )

  // ── Actions ───────────────────────────────────────────────────────────────

  /**
   * Close the picker and restore the shadow block's visual state to `base`
   * (dim icon, no selected CSS class).
   */
  const close = useCallback(() => {
    const id = targetBlockIdRef.current
    if (id && workspaceRef.current) {
      const block = workspaceRef.current.getBlockById(id)
      const blockSvg = block
      if (blockSvg) {
        blockSvg.getSvgRoot?.()?.classList.remove('shadow-block--selected')
        setShadowIconState(blockSvg, false)
      }
    }
    setPosition(null)
    setPopoverType(null)
    setTargetBlockId(null)
    setSearchQuery('')
  }, [workspaceRef, setTargetBlockId])

  /**
   * Open the picker for a specific shadow block.
   *
   * @param blockId     ID of the shadow block that was clicked.
   * @param type        The semantic context used to select the item list.
   * @param pos         Screen coordinates at which to anchor the `<Menu>`.
   */
  const open = useCallback(
    (blockId: string, type: ShadowPopoverType, pos: ShadowPickerPosition) => {
      setTargetBlockId(blockId)
      setPopoverType(type)
      setPosition(pos)
      setSearchQuery('')
    },
    [setTargetBlockId],
  )

  /**
   * Handle the user selecting an item from the picker.
   *
   * Creates the appropriate real block from the item descriptor, fires a
   * `BlockCreate` event (so the undo stack records the action), then connects
   * the new block to the parent connection that the shadow block was occupying.
   *
   * For entity blocks (object / location / action) the block's `data` field and
   * `name` label are populated from the selected item.
   * For direct blocks (sensor, logic, etc.) the shadow inputs are pre-filled
   * via `getBlockInputState`.
   */
  const selectItem = useCallback(
    (item: ShadowPickerItem) => {
      const workspace = workspaceRef.current
      const shadowBlockId = targetBlockIdRef.current

      if (!workspace || !shadowBlockId) return
      const shadowBlock = workspace.getBlockById(shadowBlockId)
      if (!shadowBlock || !shadowBlock.isShadow()) return

      const isSequence =
        shadowBlock.type === 'shadow_sequence_block' ||
        shadowBlock.type === 'shadow_start_sequence_block'

      const parentConnection = isSequence
        ? shadowBlock.previousConnection?.targetConnection
        : shadowBlock.outputConnection?.targetConnection
      if (!parentConnection) return

      const selectedBlockType =
        item.blockType ?? resolveRealBlockTypeFromShadow(shadowBlock.type)
      if (!selectedBlockType) return

      const isEntityBlock =
        selectedBlockType === 'object_block' ||
        selectedBlockType === 'location_block' ||
        selectedBlockType === 'action_block'
      const isMacroBlock = selectedBlockType === 'macro_task_block'

      close()

      const groupId = Blockly.utils.idGenerator.genUid()
      Blockly.Events.setGroup(groupId)

      try {
        const displayName =
          item.name.trim().length > 0 ? item.name.trim() : `${item.id}`

        // Build the serialisation state depending on block category:
        // - Entity and macro blocks store a JSON data payload with id + name + keywords.
        // - Direct blocks (sensors, logic) receive pre-built shadow inputs.
        const baseState: State = isMacroBlock
          ? {
              type: 'macro_task_block',
              fields: { name: displayName },
              data: JSON.stringify({
                id: item.id,
                name: displayName,
                keywords: toKeywordsCsvOrNull(item.keywords),
              }),
            }
          : isEntityBlock
            ? {
                type: selectedBlockType,
                fields: { name: displayName },
                data: JSON.stringify({
                  id: item.id,
                  name: displayName,
                  keywords: toKeywordsCsvOrNull(item.keywords),
                }),
              }
            : {
                type: selectedBlockType,
                ...(DIRECT_BLOCK_TYPES.has(selectedBlockType)
                  ? getBlockInputState(selectedBlockType)
                  : {}),
              }

        const newBlock = Blockly.serialization.blocks.append(
          baseState,
          workspace,
        ) as Blockly.BlockSvg
        newBlock.initSvg()
        newBlock.render()

        Blockly.Events.fire(new Blockly.Events.BlockCreate(newBlock))

        if (isSequence) {
          if (newBlock.previousConnection)
            parentConnection.connect(newBlock.previousConnection)
        } else {
          if (newBlock.outputConnection)
            parentConnection.connect(newBlock.outputConnection)
        }
      } finally {
        Blockly.Events.setGroup(false)
      }
    },
    [workspaceRef, close],
  )

  return {
    isOpen: position !== null && popoverType !== null && targetBlockId !== null,
    position,
    popoverType,
    targetBlockId,
    searchQuery,
    filteredItems,
    groupedItems,
    targetBlockIdRef,
    open,
    close,
    selectItem,
    setSearchQuery,
  }
}
