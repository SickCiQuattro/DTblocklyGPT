import * as Blockly from 'blockly/core'
import {
  ArrowLeftRight,
  CircleHelp,
  ClipboardPaste,
  Copy,
  LayoutTemplate,
  MessageSquare,
  Minimize2,
  Minus,
  Maximize2,
  EyeOff,
  Eye,
  Pencil,
  Plus,
  Redo2,
  Scissors,
  LayoutDashboard,
  AlignJustify,
  Trash2,
  Undo2,
} from 'lucide-react'

import { countRealBlocks, getOwnBodyDescendants } from 'utils/blocklySelection'

export interface ContextMenuAction {
  id: number
  text: string
  enabled: boolean
  callback: () => void
}

/** Separator sentinel — rendered as a visual divider, not a clickable item. */
export interface ContextMenuSeparator {
  separator: true
}

export type ContextMenuEntry = ContextMenuAction | ContextMenuSeparator

export interface ContextMenuState {
  mouseX: number
  mouseY: number
  options: ContextMenuEntry[]
  blockId: string | null
}

/**
 * Called when the user clicks "Inline Task" on a macro block.
 * The caller is responsible for showing a confirmation modal before
 * invoking the actual onExpandMacro handler.
 *
 * @param macroName   Human-readable name of the macro (for modal copy).
 * @param onConfirm   Execute the inline operation if the user confirms.
 */
export type RequestInlineTaskConfirmation = (
  macroName: string,
  onConfirm: () => void,
) => void

interface InstallContextMenuBridgeParams {
  workspaceRef: { current: Blockly.WorkspaceSvg | null }
  setContextMenu: (menu: ContextMenuState | null) => void
  getNextOptionId: () => number
  onExpandMacro: (
    block: Blockly.BlockSvg,
    workspace: Blockly.WorkspaceSvg,
  ) => void
  resolveMacroId: (rawData: unknown) => string | null
  /**
   * Optional — when provided, clicking "Inline Task" will invoke this callback
   * so the caller can show a confirmation modal before committing.
   */
  requestInlineTaskConfirmation?: RequestInlineTaskConfirmation
}
type BridgedMenuOption =
  | Blockly.ContextMenuRegistry.ContextMenuOption
  | Blockly.ContextMenuRegistry.LegacyContextMenuOption

type BlockWithGeneratedContextMenu = Blockly.BlockSvg & {
  generateContextMenu?: (event: Event) => BridgedMenuOption[] | null
}

// Blockly context-menu labels — they can be plain strings or DOM nodes.
export const getMenuOptionText = (
  text: string | HTMLElement | undefined,
): string => {
  if (typeof text === 'string') return text
  if (text instanceof HTMLElement)
    return (text.innerText || text.textContent || '').trim()
  return ''
}

const LABEL_MAP: Record<string, string> = {
  // Block layout
  'expand block': 'Show Block Details',
  'collapse block': 'Compact Block',
  // Input layout
  'inline inputs': 'Compact Layout',
  'external inputs': 'Expanded Layout',
  // Block state
  'enable block': 'Include This Step',
  'disable block': 'Skip This Step',
  // Workspace
  'clean up workspace': 'Arrange Blocks',
  'clean up': 'Arrange Blocks',
  // Comment
  'add comment': 'Add Note',
  'remove comment': 'Remove Note',
}

/**
 * Returns the user-friendly label for a given raw Blockly option text.
 * Unrecognised labels are returned as-is.
 */
export const rewriteLabel = (raw: string): string => {
  const key = raw.toLowerCase().trim()
  return LABEL_MAP[key] ?? raw
}

const NEUTRAL = '#475569'
const DESTRUCTIVE = '#DC2626'
const ADDITIVE = '#15803D'

export const getMenuIconInfo = (text: string) => {
  const n = text.toLowerCase()
  const has = (terms: string[]) => terms.some((t) => n.includes(t))
  if (has(['delete'])) return { Icon: Trash2, color: DESTRUCTIVE }
  if (has(['duplicate', 'copy'])) return { Icon: Copy, color: NEUTRAL }
  if (has(['cut'])) return { Icon: Scissors, color: NEUTRAL }
  if (has(['paste'])) return { Icon: ClipboardPaste, color: NEUTRAL }
  if (has(['undo'])) return { Icon: Undo2, color: NEUTRAL }
  if (has(['redo'])) return { Icon: Redo2, color: NEUTRAL }
  if (has(['inline task'])) return { Icon: ArrowLeftRight, color: DESTRUCTIVE }
  if (has(['show block details'])) return { Icon: Maximize2, color: NEUTRAL }
  if (has(['compact block'])) return { Icon: Minimize2, color: NEUTRAL }
  if (has(['compact layout'])) return { Icon: Minimize2, color: NEUTRAL }
  if (has(['expanded layout'])) return { Icon: LayoutDashboard, color: NEUTRAL }
  if (has(['include this step'])) return { Icon: Eye, color: ADDITIVE }
  if (has(['skip this step'])) return { Icon: EyeOff, color: NEUTRAL }
  if (has(['rename'])) return { Icon: Pencil, color: NEUTRAL }
  if (has(['arrange blocks'])) return { Icon: AlignJustify, color: NEUTRAL }
  if (has(['add note'])) return { Icon: MessageSquare, color: ADDITIVE }
  if (has(['remove note'])) return { Icon: MessageSquare, color: DESTRUCTIVE }
  if (has(['help'])) return { Icon: CircleHelp, color: NEUTRAL }
  if (has(['add '])) return { Icon: Plus, color: ADDITIVE }
  if (has(['remove '])) return { Icon: Minus, color: DESTRUCTIVE }

  return { Icon: LayoutTemplate, color: NEUTRAL }
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTION ORDERING
//
// Destructive actions (delete, inline task) are always moved to the bottom,
// separated from editing actions by a divider.
// ─────────────────────────────────────────────────────────────────────────────

const DESTRUCTIVE_LABELS = ['delete', 'inline task']

const isDestructiveLabel = (label: string) => {
  const n = label.toLowerCase()
  return DESTRUCTIVE_LABELS.some((d) => n.includes(d))
}

const sortAndSeparateOptions = (
  options: ContextMenuAction[],
): ContextMenuEntry[] => {
  const normal = options.filter((o) => !isDestructiveLabel(o.text))
  const destructive = options.filter((o) => isDestructiveLabel(o.text))

  if (destructive.length === 0) return normal
  return [...normal, { separator: true }, ...destructive]
}

// SEPARATOR HELPER

const isSeparatorOption = (
  option: BridgedMenuOption,
): option is Blockly.ContextMenuRegistry.SeparatorContextMenuOption =>
  'separator' in option && option.separator === true

const toWorkspaceSvg = (
  workspace: Blockly.Workspace | null | undefined,
): Blockly.WorkspaceSvg | undefined =>
  workspace instanceof Blockly.WorkspaceSvg ? workspace : undefined

/**
 * Monkey-patches Blockly's context-menu internals so that every right-click
 * menu is rendered by the React/MUI layer instead of Blockly's built-in popup.
 *
 * Returns a cleanup function that restores the original Blockly behaviour
 * (call it in a useEffect cleanup or on component unmount).
 */
export const installContextMenuBridge = ({
  workspaceRef,
  setContextMenu,
  getNextOptionId,
  onExpandMacro,
  resolveMacroId,
  requestInlineTaskConfirmation,
}: InstallContextMenuBridgeParams) => {
  const originalContextMenuShow = Blockly.ContextMenu.show
  const originalContextMenuHide = Blockly.ContextMenu.hide

  const blockPrototype = Blockly.BlockSvg?.prototype
  const workspacePrototype = Blockly.WorkspaceSvg?.prototype
  const connectionPrototype = Blockly.RenderedConnection?.prototype

  const originalBlockShowContextMenu =
    typeof blockPrototype?.showContextMenu === 'function'
      ? blockPrototype.showContextMenu
      : null
  const originalWorkspaceShowContextMenu =
    typeof workspacePrototype?.showContextMenu === 'function'
      ? workspacePrototype.showContextMenu
      : null
  const originalConnectionShowContextMenu =
    typeof connectionPrototype?.showContextMenu === 'function'
      ? connectionPrototype.showContextMenu
      : null

  // Scope resolver
  const resolveScope = (
    fallbackScope?: Blockly.ContextMenuRegistry.Scope,
  ): Blockly.ContextMenuRegistry.Scope | null => {
    if (fallbackScope) return fallbackScope
    if (workspaceRef.current)
      return {
        workspace: workspaceRef.current,
        focusedNode: workspaceRef.current,
      }
    return null
  }

  // Core menu builder
  const openMuiContextMenu = (
    menuOpenEvent: Event,
    menuOptions: ReadonlyArray<BridgedMenuOption> | null | undefined,
    fallbackScope?: Blockly.ContextMenuRegistry.Scope,
    blockId?: string | null,
  ) => {
    menuOpenEvent.preventDefault()
    menuOpenEvent.stopPropagation()

    let mouseX = 0
    let mouseY = 0

    if ('clientX' in menuOpenEvent && 'clientY' in menuOpenEvent) {
      const e = menuOpenEvent as MouseEvent
      mouseX = Number.isFinite(e.clientX) ? e.clientX : 0
      mouseY = Number.isFinite(e.clientY) ? e.clientY : 0
    } else if (workspaceRef.current) {
      const rect = workspaceRef.current
        .getInjectionDiv()
        .getBoundingClientRect()
      mouseX = Math.round(rect.left + rect.width / 2)
      mouseY = Math.round(rect.top + rect.height / 2)
    }

    const menuLocation = new Blockly.utils.Coordinate(mouseX, mouseY)

    const rawOptions = (menuOptions ?? [])
      .map((option): ContextMenuAction | null => {
        if (isSeparatorOption(option)) return null

        let rawLabel = getMenuOptionText(option.text)
        if (/^delete \d+ blocks?$/i.test(rawLabel)) {
          const ws = workspaceRef.current
          if (ws) {
            const realCount = countRealBlocks(
              ws.getAllBlocks(false),
              'when_start',
            )
            rawLabel =
              realCount > 1
                ? `Delete ${realCount} blocks`
                : realCount === 1
                  ? 'Delete block'
                  : 'Delete blocks'
          }
        }

        if (!rawLabel || typeof option.callback !== 'function') return null

        const actionScope =
          'scope' in option ? option.scope : resolveScope(fallbackScope)

        if (rawLabel.toLowerCase().includes('delete') && actionScope?.block) {
          const block = actionScope.block as Blockly.BlockSvg
          const bodyCount = getOwnBodyDescendants(block).length
          const count = 1 + bodyCount
          rawLabel = count > 1 ? `Delete ${count} blocks` : `Delete block`
        }

        // rewrite technical Blockly labels to user-friendly language
        const label = rewriteLabel(rawLabel)

        const buildAction = (callFn: () => void): ContextMenuAction => ({
          id: getNextOptionId(),
          text: label,
          enabled: option.enabled ?? true,
          callback: callFn,
        })

        if ('scope' in option) {
          const actionScope = option.scope ?? resolveScope(fallbackScope)
          if (!actionScope) return null

          return buildAction(() =>
            option.callback(
              actionScope,
              menuOpenEvent,
              new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                clientX: mouseX,
                clientY: mouseY,
              }),
              menuLocation,
            ),
          )
        }

        const legacyScope = resolveScope(fallbackScope)
        if (!legacyScope) return null

        return buildAction(() => option.callback(legacyScope))
      })
      .filter((o): o is ContextMenuAction => o !== null)

    // sort destructive items to the bottom, add separator
    const entries = sortAndSeparateOptions(rawOptions)

    setContextMenu(
      entries.length > 0
        ? { mouseX, mouseY, options: entries, blockId: blockId ?? null }
        : null,
    )
  }

  // Patch Blockly.ContextMenu
  Blockly.ContextMenu.show = function (menuOpenEvent, menuOptions) {
    openMuiContextMenu(menuOpenEvent, menuOptions)
  }

  Blockly.ContextMenu.hide = function () {
    setContextMenu(null)
  }

  // Patch BlockSvg.showContextMenu
  if (blockPrototype && originalBlockShowContextMenu) {
    blockPrototype.showContextMenu = function (
      this: Blockly.BlockSvg,
      event: Event,
    ) {
      const blockWithMenu = this as BlockWithGeneratedContextMenu
      const generatedOptions =
        typeof blockWithMenu.generateContextMenu === 'function'
          ? blockWithMenu.generateContextMenu(event)
          : null

      const menuOptions: BridgedMenuOption[] = Array.isArray(generatedOptions)
        ? [...generatedOptions]
        : []

      const sourceBlock = this
      const sourceWorkspace = toWorkspaceSvg(sourceBlock.workspace)

      // "Inline Task" option for macro_task_block
      if (sourceBlock.type === 'macro_task_block') {
        const macroId = resolveMacroId(sourceBlock.data)
        const isEnabled = !!sourceWorkspace && !!macroId

        // Derive macro name for the confirmation modal copy
        let macroName = 'this task'
        try {
          const parsed =
            typeof sourceBlock.data === 'string'
              ? JSON.parse(sourceBlock.data)
              : sourceBlock.data
          if (parsed?.name) macroName = String(parsed.name)
        } catch {
          /* leave default */
        }

        const inlineOption = {
          text: 'Inline Task',
          enabled: isEnabled,
          scope: {
            block: sourceBlock,
            workspace: sourceWorkspace,
            focusedNode: sourceBlock,
          },
          callback: (scope: Blockly.ContextMenuRegistry.Scope) => {
            const blockFromScope = scope?.block
            const workspaceFromScope = scope?.workspace
            if (!blockFromScope || !workspaceFromScope) return

            const executeInline = () =>
              onExpandMacro(blockFromScope, workspaceFromScope)

            // show confirmation modal for irreversible operation
            if (requestInlineTaskConfirmation) {
              requestInlineTaskConfirmation(macroName, executeInline)
            } else {
              executeInline()
            }
          },
        }

        const deleteIdx = menuOptions.findIndex((o) => {
          if (isSeparatorOption(o)) return false
          return getMenuOptionText(o.text).toLowerCase().includes('delete')
        })

        if (deleteIdx >= 0) {
          menuOptions.splice(deleteIdx, 0, inlineOption)
        } else {
          menuOptions.push(inlineOption)
        }
      }

      const BLOCKS_WITH_COLLAPSIBLE_BODY = new Set([
        'repeat_block',
        'loop_block',
        'repeat_until_block',
        'when_block',
        'when_otherwise_block',
      ])

      const ALWAYS_HIDDEN_LABELS = new Set([
        'compact layout',
        'expanded layout',
        'inline inputs',
        'external inputs',
      ])

      const filteredOptions = menuOptions.filter((option) => {
        if (isSeparatorOption(option)) return true
        const label = getMenuOptionText(option.text).toLowerCase()

        if (ALWAYS_HIDDEN_LABELS.has(label)) return false

        if (
          (label.includes('compact block') ||
            label.includes('show block details') ||
            label.includes('collapse block') ||
            label.includes('expand block')) &&
          !BLOCKS_WITH_COLLAPSIBLE_BODY.has(sourceBlock.type)
        ) {
          return false
        }

        return true
      })

      openMuiContextMenu(
        event,
        filteredOptions,
        {
          block: sourceBlock,
          workspace: sourceWorkspace,
          focusedNode: sourceBlock,
        },
        sourceBlock.id,
      )
    }
  }

  // Patch WorkspaceSvg.showContextMenu
  if (workspacePrototype && originalWorkspaceShowContextMenu) {
    workspacePrototype.showContextMenu = function (
      this: Blockly.WorkspaceSvg,
      event: Event,
    ) {
      const isReadOnly =
        typeof this.isReadOnly === 'function'
          ? this.isReadOnly()
          : this.options?.readOnly === true

      if (isReadOnly || this.isFlyout) return

      const menuOptions =
        Blockly.ContextMenuRegistry.registry.getContextMenuOptions(
          { workspace: this, focusedNode: this },
          event,
        )

      if (typeof this.configureContextMenu === 'function') {
        this.configureContextMenu(menuOptions, event)
      }

      openMuiContextMenu(event, menuOptions, {
        workspace: this,
        focusedNode: this,
      })
    }
  }

  // Patch RenderedConnection.showContextMenu
  if (connectionPrototype && originalConnectionShowContextMenu) {
    connectionPrototype.showContextMenu = function (
      this: Blockly.RenderedConnection,
      event: Event,
    ) {
      const sourceBlock =
        typeof this.getSourceBlock === 'function' ? this.getSourceBlock() : null
      const sourceWorkspace = toWorkspaceSvg(sourceBlock?.workspace)

      const menuOptions =
        Blockly.ContextMenuRegistry.registry.getContextMenuOptions(
          {
            focusedNode: this,
            ...(sourceBlock ? { block: sourceBlock } : {}),
            ...(sourceWorkspace ? { workspace: sourceWorkspace } : {}),
          },
          event,
        )

      openMuiContextMenu(event, menuOptions, {
        focusedNode: this,
        ...(sourceBlock ? { block: sourceBlock } : {}),
        ...(sourceWorkspace ? { workspace: sourceWorkspace } : {}),
      })
    }
  }

  // Cleanup (call on unmount)
  return () => {
    Blockly.ContextMenu.show = originalContextMenuShow
    Blockly.ContextMenu.hide = originalContextMenuHide

    if (blockPrototype && originalBlockShowContextMenu)
      blockPrototype.showContextMenu = originalBlockShowContextMenu
    if (workspacePrototype && originalWorkspaceShowContextMenu)
      workspacePrototype.showContextMenu = originalWorkspaceShowContextMenu
    if (connectionPrototype && originalConnectionShowContextMenu)
      connectionPrototype.showContextMenu = originalConnectionShowContextMenu
  }
}
