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
 * docs/ui-naming-map.md for the full code-name ↔ user-facing-label map.
 *
 * Not exhaustive by design: only terms that were found duplicated (and
 * drifting) across files during the Nielsen/WCAG audit are centralized here.
 * A one-off string with a single call site doesn't need an entry — add one
 * only once a second surface needs the same term.
 */

export const UI_TEXT = {
  // Execution. Three questions, three vocabularies, and they must not borrow
  // each other's words — this is what "Task Execution" (a tab), "Simulate" (a
  // mode) and "Start simulation" (a button) were: three names for one thing,
  // in front of an operator who has to learn the app in one session.
  //
  //   WHERE it runs  → a noun, on the mode control:  Simulation / Real robot
  //   DO it          → a verb, on the button:        Start simulation / Run on robot
  //   WHAT I'm seeing→ a noun, on the live-view tab: Robot / Test recognition
  //
  // The worst offender was not the tab: the mode's own label and the button's
  // label were the SAME STRING for a hardware run. The operator chose "Run on
  // robot" and then pressed "Run on robot", with no way to tell a setting from
  // an action. Nouns for the setting fixed that without inventing a word.
  //
  // "Test recognition" stays exactly as it is — testing/recognition_plan.py
  // instructs an observer to count trials "off the app's own 'Test
  // recognition' panel", so renaming it would silently break the study
  // protocol's own reference.
  targetSimulation: 'Simulation',
  targetRobot: 'Real robot',
  liveViewRobot: 'Robot',
  liveViewSandbox: 'Test recognition',
  /** Verb form, for a card action ("Simulate this task"). Not the mode label. */
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
