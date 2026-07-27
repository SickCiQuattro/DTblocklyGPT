/**
 * uiVocabulary.ts
 *
 * Single source of truth for user-facing terms that appear on more than one
 * surface (button, tooltip, chip, dialog, StatusBar...). Generalizes the
 * LABEL_MAP pattern in features/blockly/editor/contextMenu.ts to the whole
 * app — import a term from here instead of retyping the string, so it only
 * has to change in one place.
 *
 * Internal code names (macro_task_block, contextualHelpEnabled, executionTarget,
 * ...) are intentionally different from these labels — see
 * docs/mappa-nomi-codice-ui.md for the full code-name ↔ user-facing-label map.
 *
 * Not exhaustive by design: only terms that were found duplicated (and
 * drifting) across files during the Nielsen/WCAG audit are centralized here.
 * A one-off string with a single call site doesn't need an entry — add one
 * only once a second surface needs the same term.
 */

export const UI_TEXT = {
  // Execution — two verbs, always the same two, never "Run in:"/"Real
  // robot"/"Run simulation" variants.
  simulate: 'Simulate',
  runOnRobot: 'Run on robot',
  startSimulation: 'Start simulation',
  simulationRunning: 'Simulation running',
  robotRunning: 'Robot running',
  idle: 'Idle',
  simulationCompleted: 'Simulation completed',
  taskCompletedOnRobot: 'Task completed on robot',

  // Publish lifecycle — three axes, one word each: draft/published status,
  // the unpublished-changes indicator, and the autosave state. Never mix
  // "draft" into the other two axes (see utils/taskStatus.ts).
  draft: 'Draft',
  published: 'Published',
  unpublishedChanges: 'Unpublished changes',
  discardUnpublishedChanges: 'Discard unpublished changes',
  unsavedChanges: 'Unsaved changes',

  // Reusable-task concept — toolbox category, block label, and the action
  // that expands it all say "Saved Task" explicitly (never bare "macro",
  // which stays as the internal/code name only).
  savedTask: 'Saved Task',
  savedTasks: 'Saved Tasks',
  breakSavedTaskIntoSteps: 'Break Saved Task into steps',

  // The left blocks panel is always "Toolbox" — never "blocks sidebar".
  toolbox: 'Toolbox',
} as const
