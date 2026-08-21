/**
 * Guards for global (document-level) keyboard shortcuts.
 *
 * A listener on `document` fires wherever focus is, so every app-wide shortcut
 * has to answer the same two questions before acting: is this keystroke part of
 * something the user is typing, and is there a modal on top that owns the
 * keyboard right now.
 */

/**
 * True when focus sits in a text control, i.e. the keystroke belongs to
 * whatever the user is typing into.
 *
 * The Blockly editor needs one more arm on top of this — an open Blockly field
 * editor, which `Blockly.WidgetDiv.isVisible()` detects wherever it is mounted.
 * Its `isTypingContext()` composes that arm onto this function rather than
 * restating the element test, so pages outside the editor can share this one
 * without pulling Blockly in.
 */
export const isTypingInTextControl = (): boolean => {
  const active = document.activeElement
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLElement && active.isContentEditable)
  )
}

/**
 * True while a modal dialog is on screen — one that traps focus and therefore
 * owns the keyboard until it is dismissed.
 *
 * Read from the DOM rather than from component state on purpose: the dialogs
 * that can cover a page are owned by components the shortcut's host can't see —
 * the Header's discard confirm, the robot panel's real-run confirm, the
 * editor's delete/search dialogs, a row's delete confirm inside the task list.
 * MUI's Dialog is what all of them are built on, and it stamps `role` and
 * `aria-modal` on the same paper element (Dialog.js), so that pair is the one
 * signal they share.
 *
 * Requiring `aria-modal="true"` rather than matching the role alone is the
 * point of the selector: it asks "does something own the keyboard right now",
 * which is a property of modality, not of being a dialog. A non-modal dialog —
 * one that leaves the page usable underneath — must not disable these
 * shortcuts. (DigitalTwinPanel used to be exactly that case, a
 * permanently-mounted slide-in declaring `role="dialog" aria-modal="false"`,
 * which a role-only selector would have read as a modal on the task workspace
 * at all times. It is a `region` landmark now, so it no longer matches either
 * way, but the reasoning is why the attribute pair is the test.)
 *
 * A closed MUI Dialog unmounts, so this can't latch on a dismissed one; the
 * single `keepMounted` in the app is the mobile nav Drawer, whose Modal renders
 * `role="presentation"` and is therefore not matched here. Menus and Popovers
 * are likewise `role="presentation"` — they don't trap focus and don't block.
 */
export const isModalOpen = (): boolean =>
  document.querySelector(
    '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
  ) !== null
