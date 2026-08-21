/**
 * appShortcuts.ts
 *
 * One table describing every keyboard shortcut the editor answers to, and the
 * helpers that install the ones this app owns.
 *
 * Why this exists: the shortcut list used to be typed by hand inside
 * KeyboardHelpDialog, with no link to the code that implements anything. It
 * drifted, and the drift was invisible — the dialog documented `T` ("jump to
 * the toolbox") and `H` ("next heading"), both of which were dead in this
 * integration because it registers no native Blockly toolbox, so those
 * shortcuts' preconditions could never be satisfied. A user following the
 * dialog pressed keys that did nothing, which reads as "the shortcuts are
 * broken" rather than "the documentation is wrong".
 *
 * So the dialog now renders from this table, and rows that mirror a *Blockly*
 * shortcut name are checked against the live ShortcutRegistry in development
 * (see warnOnShortcutDrift). That catches a Blockly upgrade removing or
 * renaming something we document — package.json pins `^13.0.0`, so the bundled
 * version can move on a plain `npm install`.
 *
 * The check verifies EXISTENCE, not the key label. Blockly's own key formatter
 * (`getShortcutKeysShort` in core/utils/shortcut_formatting.ts) would render the
 * labels for us, but it is not reachable: the package's `exports` map publishes
 * only `.`, `./core`, `./blocks`, the generators and `./msg/*` — no
 * `./core/utils/*` subpath — so importing it would break module resolution.
 * Labels stay hand-written; the check makes sure they still describe something
 * that exists.
 */
import * as Blockly from 'blockly/core'

// Platform detection is Blockly's own, deliberately not `navigator.platform`:
// that property is deprecated and frozen in current browsers, so it can report
// the wrong OS. Reusing Blockly's flag also keeps these labels agreeing with
// the shortcut hints Blockly itself renders, which format modifiers from it.
const IS_APPLE = Blockly.utils.userAgent.APPLE
export const MOD = IS_APPLE ? 'Cmd' : 'Ctrl'
/** macOS has no Alt key: the same physical key is Option (⌥). */
export const ALT = IS_APPLE ? 'Option' : 'Alt'

export interface ShortcutRow {
  /** Key label as shown to the user. Hand-written; see the module comment. */
  keys: string
  /** What pressing it does, in the user's terms. */
  description: string
  /**
   * The name this row mirrors in Blockly's ShortcutRegistry, when Blockly is
   * the thing that implements it. Rows the app implements itself leave this
   * unset — there is no registry entry to check them against.
   */
  blocklyName?: string
}

/**
 * Every shortcut the editor answers to, in the order the help dialog shows
 * them: getting around first, then acting on a block, then the app's own.
 */
export const SHORTCUT_ROWS: ShortcutRow[] = [
  { keys: 'Tab', description: 'Move focus into the blocks workspace' },
  {
    keys: 'Arrow keys',
    description: 'Move between blocks, fields and connections',
  },
  {
    keys: 'W',
    description: 'Jump focus to the workspace',
    blocklyName: 'focus_workspace',
  },
  {
    keys: 'N / B',
    description: 'Go to the next / previous stack',
    blocklyName: 'next_stack',
  },
  {
    keys: 'Enter / Space',
    description:
      'Fill the highlighted slot, or open the editor for a field. On a plain block it explains where you are.',
    blocklyName: 'perform_action',
  },
  {
    keys: 'M',
    description:
      'Pick up the selected block to move it — this is how you put a block inside a Repeat or a When',
    blocklyName: 'start_move',
  },
  {
    keys: 'Shift+M',
    description: 'Pick up the whole stack to move it',
    blocklyName: 'start_move_stack',
  },
  // Worth spelling out: the arrows here do NOT nudge the block around, they
  // step it between the connection points it is actually allowed to join
  // (Blockly's CONSTRAINED move mode — a plain arrow is constrained, an arrow
  // with Ctrl/Cmd is free movement). Described as "position the block" nobody
  // guessed that this is how a loose block gets attached to the program.
  {
    keys: 'Arrows, then Enter',
    description:
      'While holding a block: the arrows step it between the places it can attach, Enter drops it there (Esc puts it back)',
    blocklyName: 'finish_move',
  },
  {
    keys: `${MOD}+Arrows`,
    description:
      'While holding a block: move it freely instead, to leave it unattached',
    blocklyName: 'move_up',
  },
  {
    keys: 'D',
    description:
      'Duplicate the selected block — the copy starts detached, press M to attach it',
    blocklyName: 'duplicate',
  },
  {
    keys: 'X / Shift+X',
    description:
      'Disconnect the selected block — plain X closes the gap behind it, Shift+X leaves it open',
    blocklyName: 'disconnect',
  },
  {
    keys: 'C',
    description: 'Clean up / tidy the workspace blocks',
    blocklyName: 'cleanup',
  },
  {
    keys: 'Delete / Backspace',
    description: 'Delete the selected block',
    blocklyName: 'delete',
  },
  {
    keys: `${MOD}+C / ${MOD}+X / ${MOD}+V`,
    description: 'Copy / cut / paste (paste lands near the focused block)',
    blocklyName: 'copy',
  },
  {
    keys: `${MOD}+Z / ${MOD}+Shift+Z / ${MOD}+Y`,
    description: 'Undo / redo',
    blocklyName: 'undo',
  },
  {
    keys: `${MOD}+Enter`,
    description: 'Open the block’s menu (also Shift+F10)',
    blocklyName: 'menu',
  },
  {
    keys: 'I / Shift+I',
    description: 'Announce block info / extended info',
    blocklyName: 'information',
  },
  {
    keys: `${MOD}+J`,
    description: 'Show the tooltip for the selected block',
    blocklyName: 'show_tooltip',
  },
  {
    keys: 'Esc',
    description: 'Close whatever is open over the workspace',
    blocklyName: 'escape',
  },
  {
    keys: `Shift+${ALT}+A`,
    description: 'Toggle screen-reader accessibility mode',
    blocklyName: 'toggle_screenreader',
  },
  // ── App shortcuts: no blocklyName, because this app implements them ──────
  {
    keys: `${MOD}+K`,
    description: 'Search for a step and add it to the end of the task',
  },
  {
    keys: 'T',
    description: 'Jump focus to the blocks palette',
  },
  {
    keys: 'H / Shift+H',
    description: 'While in the palette: next / previous category',
  },
]

/** Names of the app's own Blockly-registered shortcuts, so both the registration
 *  and the teardown refer to the same strings. */
export const APP_SHORTCUT_NAMES = {
  openShadowPicker: 'open_shadow_picker',
  focusToolbox: 'focus_react_toolbox',
} as const

/**
 * Register app-owned shortcuts with Blockly and return their teardown.
 *
 * `register()` re-runs its key-mapping step with no de-duplication, so a
 * remount without the matching `unregister` leaves duplicate entries in the key
 * map. Returning the cleanup makes that hard to forget.
 */
export const registerAppShortcuts = (
  shortcuts: Blockly.ShortcutRegistry.KeyboardShortcut[],
): (() => void) => {
  for (const shortcut of shortcuts) {
    Blockly.ShortcutRegistry.registry.register(shortcut, true)
  }
  return () => {
    for (const shortcut of shortcuts) {
      Blockly.ShortcutRegistry.registry.unregister(shortcut.name)
    }
  }
}

/**
 * Development-only check that every row claiming to mirror a Blockly shortcut
 * still mirrors one. Silent in production.
 *
 * This is the guard the old hand-maintained list lacked: it does not verify the
 * printed key label, only that the shortcut it describes is still registered —
 * which is exactly the failure that made the dialog list dead keys.
 */
export const warnOnShortcutDrift = (): void => {
  if (!import.meta.env.DEV) return
  for (const row of SHORTCUT_ROWS) {
    if (!row.blocklyName) continue
    const codes = Blockly.ShortcutRegistry.registry.getKeyCodesByShortcutName(
      row.blocklyName,
    )
    if (codes.length === 0) {
      console.warn(
        `[appShortcuts] Blockly no longer registers "${row.blocklyName}". ` +
          `The help dialog still lists "${row.keys}" (${row.description}), ` +
          `which now does nothing. Fix the row or drop it.`,
      )
    }
  }
}
