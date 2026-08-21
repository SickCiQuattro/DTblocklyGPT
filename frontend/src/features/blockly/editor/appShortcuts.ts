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
 * So the dialog now renders from this table, and every Blockly shortcut a row
 * documents is checked against the live ShortcutRegistry in development
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
   * Every Blockly ShortcutRegistry name this row documents. A single row often
   * covers more than one — "N / B" is next_stack AND previous_stack, the
   * copy/cut/paste row is three — and naming only the first meant the drift
   * check below silently verified a third of what the row claims.
   *
   * Left unset for rows Blockly does not implement: the app's own shortcuts,
   * and Tab, which is the browser's focus order rather than a shortcut at all.
   */
  blocklyNames?: string[]
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
    blocklyNames: ['up', 'down', 'left', 'right'],
  },
  {
    keys: 'W',
    description: 'Jump focus to the workspace',
    blocklyNames: ['focus_workspace'],
  },
  {
    keys: 'N / B',
    description: 'Go to the next / previous stack',
    blocklyNames: ['next_stack', 'previous_stack'],
  },
  {
    keys: 'Enter / Space',
    description:
      'Fill the highlighted slot, or open the editor for a field. On a plain block it explains where you are.',
    blocklyNames: ['perform_action'],
  },
  {
    keys: 'M',
    description:
      'Pick up the selected block to move it — this is how you put a block inside a Repeat or a When',
    blocklyNames: ['start_move'],
  },
  {
    keys: 'Shift+M',
    description: 'Pick up the whole stack to move it',
    blocklyNames: ['start_move_stack'],
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
    blocklyNames: ['finish_move', 'abort_move'],
  },
  {
    keys: `${MOD}+Arrows`,
    description:
      'While holding a block: move it freely instead, to leave it unattached',
    blocklyNames: ['move_up', 'move_down', 'move_left', 'move_right'],
  },
  {
    keys: 'D',
    description:
      'Duplicate the selected block — the copy starts detached, press M to attach it',
    blocklyNames: ['duplicate'],
  },
  {
    keys: 'X / Shift+X',
    description:
      'Disconnect the selected block — plain X closes the gap behind it, Shift+X leaves it open',
    blocklyNames: ['disconnect'],
  },
  {
    keys: 'C',
    description: 'Clean up / tidy the workspace blocks',
    blocklyNames: ['cleanup'],
  },
  {
    keys: 'Delete / Backspace',
    description: 'Delete the selected block',
    blocklyNames: ['delete'],
  },
  {
    keys: `${MOD}+C / ${MOD}+X / ${MOD}+V`,
    description: 'Copy / cut / paste (paste lands near the focused block)',
    blocklyNames: ['copy', 'cut', 'paste'],
  },
  {
    keys: `${MOD}+Z / ${MOD}+Shift+Z / ${MOD}+Y`,
    description: 'Undo / redo',
    blocklyNames: ['undo', 'redo'],
  },
  {
    keys: `${MOD}+Enter`,
    description: 'Open the block’s menu (also Shift+F10)',
    blocklyNames: ['menu'],
  },
  {
    keys: 'I / Shift+I',
    description: 'Announce block info / extended info',
    blocklyNames: ['information', 'extended_information'],
  },
  {
    keys: `${MOD}+J`,
    description: 'Show the tooltip for the selected block',
    blocklyNames: ['show_tooltip'],
  },
  {
    keys: 'Esc',
    description: 'Close whatever is open over the workspace',
    blocklyNames: ['escape'],
  },
  {
    keys: `Shift+${ALT}+A`,
    description: 'Toggle screen-reader accessibility mode',
    blocklyNames: ['toggle_screenreader'],
  },
  // ── App shortcuts: no blocklyNames, because this app implements them ─────
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
    for (const name of row.blocklyNames ?? []) {
      const codes =
        Blockly.ShortcutRegistry.registry.getKeyCodesByShortcutName(name)
      if (codes.length === 0) {
        console.warn(
          `[appShortcuts] Blockly no longer registers "${name}". ` +
            `The help dialog still lists "${row.keys}" (${row.description}), ` +
            `which now does nothing in part or in full. Fix the row or drop it.`,
        )
      }
    }
  }
}
