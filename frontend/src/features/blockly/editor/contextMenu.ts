import * as Blockly from 'blockly/core'
import {
  Bomb,
  Check,
  CircleHelp,
  ClipboardPaste,
  Copy,
  Maximize,
  Minimize2,
  Minus,
  Pencil,
  Plus,
  Redo2,
  Scissors,
  Settings,
  Settings2,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'

export interface ContextMenuAction {
  id: number
  text: string
  enabled: boolean
  callback: () => void
}

export interface ContextMenuState {
  mouseX: number
  mouseY: number
  options: ContextMenuAction[]
}

interface InstallContextMenuBridgeParams {
  workspaceRef: { current: Blockly.WorkspaceSvg | null }
  setContextMenu: (menu: ContextMenuState | null) => void
  getNextOptionId: () => number
  onExpandMacro: (
    block: Blockly.BlockSvg,
    workspace: Blockly.WorkspaceSvg,
  ) => void
  resolveMacroId: (rawData: unknown) => string | null
}

type BridgedMenuOption =
  | Blockly.ContextMenuRegistry.ContextMenuOption
  | Blockly.ContextMenuRegistry.LegacyContextMenuOption

type BlockWithGeneratedContextMenu = Blockly.BlockSvg & {
  generateContextMenu?: (event: Event) => BridgedMenuOption[] | null
}

const isSeparatorOption = (
  option: BridgedMenuOption,
): option is Blockly.ContextMenuRegistry.SeparatorContextMenuOption => {
  return 'separator' in option && option.separator === true
}

const toWorkspaceSvg = (
  workspace: Blockly.Workspace | null | undefined,
): Blockly.WorkspaceSvg | undefined => {
  return workspace instanceof Blockly.WorkspaceSvg ? workspace : undefined
}

/**
 * Normalize Blockly context-menu labels that can be provided as plain strings or DOM nodes.
 */
export const getMenuOptionText = (
  text: string | HTMLElement | undefined,
): string => {
  if (typeof text === 'string') {
    return text
  }

  if (text instanceof HTMLElement) {
    return (text.innerText || text.textContent || '').trim()
  }

  return ''
}

/**
 * Resolve menu icon and color based on the option text.
 */
export const getMenuIconInfo = (text: string) => {
  const normalized = text.toLowerCase()
  const containsAny = (terms: string[]) =>
    terms.some((term) => normalized.includes(term))

  if (containsAny(['delete'])) {
    return { Icon: Trash2, color: '#DC2626' }
  }

  if (containsAny(['duplicate', 'copy'])) {
    return { Icon: Copy, color: '#2563EB' }
  }

  if (containsAny(['cut'])) {
    return { Icon: Scissors, color: '#0891B2' }
  }

  if (containsAny(['paste'])) {
    return { Icon: ClipboardPaste, color: '#0F766E' }
  }

  if (containsAny(['undo'])) {
    return { Icon: Undo2, color: '#334155' }
  }

  if (containsAny(['redo'])) {
    return { Icon: Redo2, color: '#334155' }
  }

  if (containsAny(['expand macro'])) {
    return { Icon: Bomb, color: '#7C3AED' }
  }

  if (containsAny(['expand block', 'expand'])) {
    return { Icon: Maximize, color: '#0F766E' }
  }

  if (containsAny(['collapse block', 'collapse'])) {
    return { Icon: Minimize2, color: '#0F766E' }
  }

  if (containsAny(['enable block', 'enable'])) {
    return { Icon: Check, color: '#15803D' }
  }

  if (containsAny(['disable block', 'disable'])) {
    return { Icon: X, color: '#B91C1C' }
  }

  if (containsAny(['rename'])) {
    return { Icon: Pencil, color: '#7C2D12' }
  }

  if (containsAny(['inline inputs', 'external inputs'])) {
    return { Icon: Settings2, color: '#334155' }
  }

  if (containsAny(['clean up'])) {
    return { Icon: Settings, color: '#475569' }
  }

  if (containsAny(['help'])) {
    return { Icon: CircleHelp, color: '#4F46E5' }
  }

  if (containsAny(['add '])) {
    return { Icon: Plus, color: '#2563EB' }
  }

  if (containsAny(['remove '])) {
    return { Icon: Minus, color: '#475569' }
  }

  return { Icon: CircleHelp, color: '#64748B' }
}

/**
 * Bridge Blockly native context-menu internals to a React/MUI rendered menu.
 */
export const installContextMenuBridge = ({
  workspaceRef,
  setContextMenu,
  getNextOptionId,
  onExpandMacro,
  resolveMacroId,
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

  const resolveScope = (
    fallbackScope?: Blockly.ContextMenuRegistry.Scope,
  ): Blockly.ContextMenuRegistry.Scope | null => {
    if (fallbackScope) {
      return fallbackScope
    }

    if (workspaceRef.current) {
      return {
        workspace: workspaceRef.current,
        focusedNode: workspaceRef.current,
      }
    }

    return null
  }

  const openMuiContextMenu = (
    menuOpenEvent: Event,
    menuOptions: ReadonlyArray<BridgedMenuOption> | null | undefined,
    fallbackScope?: Blockly.ContextMenuRegistry.Scope,
  ) => {
    menuOpenEvent.preventDefault()
    menuOpenEvent.stopPropagation()

    let mouseX = 0
    let mouseY = 0

    if ('clientX' in menuOpenEvent && 'clientY' in menuOpenEvent) {
      const mouseEvent = menuOpenEvent as MouseEvent
      mouseX = Number.isFinite(mouseEvent.clientX) ? mouseEvent.clientX : 0
      mouseY = Number.isFinite(mouseEvent.clientY) ? mouseEvent.clientY : 0
    } else if (workspaceRef.current) {
      const workspaceRect = workspaceRef.current
        .getInjectionDiv()
        .getBoundingClientRect()
      mouseX = Math.round(workspaceRect.left + workspaceRect.width / 2)
      mouseY = Math.round(workspaceRect.top + workspaceRect.height / 2)
    }

    const menuLocation = new Blockly.utils.Coordinate(mouseX, mouseY)

    const options = (menuOptions || [])
      .map((option) => {
        if (isSeparatorOption(option)) {
          return null
        }

        const label = getMenuOptionText(option.text)
        if (!label || typeof option.callback !== 'function') {
          return null
        }

        if ('scope' in option) {
          const actionScope = option.scope ?? resolveScope(fallbackScope)
          if (!actionScope) {
            return null
          }

          return {
            id: getNextOptionId(),
            text: label,
            enabled: option.enabled ?? true,
            callback: () => {
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
              )
            },
          }
        }

        const legacyScope = resolveScope(fallbackScope)
        if (!legacyScope) {
          return null
        }

        return {
          id: getNextOptionId(),
          text: label,
          enabled: option.enabled ?? true,
          callback: () => {
            option.callback(legacyScope)
          },
        }
      })
      .filter((option): option is ContextMenuAction => option !== null)

    setContextMenu(
      options.length > 0
        ? {
            mouseX,
            mouseY,
            options,
          }
        : null,
    )
  }

  Blockly.ContextMenu.show = function (menuOpenEvent, menuOptions) {
    openMuiContextMenu(menuOpenEvent, menuOptions)
  }

  Blockly.ContextMenu.hide = function () {
    setContextMenu(null)
  }

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

      const menuOptions = Array.isArray(generatedOptions)
        ? [...generatedOptions]
        : []

      const sourceBlock = this
      const sourceWorkspace = toWorkspaceSvg(sourceBlock.workspace)

      if (sourceBlock.type === 'macro_task_block') {
        const explodeOption = {
          text: 'Expand Macro',
          enabled: !!sourceWorkspace && !!resolveMacroId(sourceBlock.data),
          scope: {
            block: sourceBlock,
            workspace: sourceWorkspace,
            focusedNode: sourceBlock,
          },
          callback: (scope: Blockly.ContextMenuRegistry.Scope) => {
            const blockFromScope = scope?.block
            const workspaceFromScope = scope?.workspace

            if (!blockFromScope || !workspaceFromScope) {
              return
            }

            onExpandMacro(blockFromScope, workspaceFromScope)
          },
        }

        const deleteOptionIndex = menuOptions.findIndex((option) => {
          if (isSeparatorOption(option)) {
            return false
          }

          const optionText = getMenuOptionText(option.text).toLowerCase()

          return optionText.includes('delete')
        })

        if (deleteOptionIndex >= 0) {
          menuOptions.splice(deleteOptionIndex, 0, explodeOption)
        } else {
          menuOptions.push(explodeOption)
        }
      }

      openMuiContextMenu(event, menuOptions, {
        block: sourceBlock,
        workspace: sourceWorkspace,
        focusedNode: sourceBlock,
      })
    }
  }

  if (workspacePrototype && originalWorkspaceShowContextMenu) {
    workspacePrototype.showContextMenu = function (
      this: Blockly.WorkspaceSvg,
      event: Event,
    ) {
      const isReadOnly =
        typeof this.isReadOnly === 'function'
          ? this.isReadOnly()
          : this.options?.readOnly === true

      if (isReadOnly || this.isFlyout) {
        return
      }

      const menuOptions =
        Blockly.ContextMenuRegistry.registry.getContextMenuOptions(
          {
            workspace: this,
            focusedNode: this,
          },
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

  return () => {
    Blockly.ContextMenu.show = originalContextMenuShow
    Blockly.ContextMenu.hide = originalContextMenuHide

    if (blockPrototype && originalBlockShowContextMenu) {
      blockPrototype.showContextMenu = originalBlockShowContextMenu
    }
    if (workspacePrototype && originalWorkspaceShowContextMenu) {
      workspacePrototype.showContextMenu = originalWorkspaceShowContextMenu
    }
    if (connectionPrototype && originalConnectionShowContextMenu) {
      connectionPrototype.showContextMenu = originalConnectionShowContextMenu
    }
  }
}
