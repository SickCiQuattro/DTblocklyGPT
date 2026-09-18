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
  /** Same target, mid-run. The header control keeps the amber escalation the
   *  old read-only chip carried: "Real robot" is a choice, "Arm live" is a
   *  fact, and the operator needs the second one while the arm is moving. */
  targetRobotLive: 'Arm live',
  liveViewRobot: 'Robot',
  liveViewSandbox: 'Test recognition',
  /** Verb form, for a card action ("Simulate this task"). Not the mode label. */
  simulate: 'Simulate',
  runOnRobot: 'Run on robot',
  startSimulation: 'Start simulation',
  simulationRunning: 'Simulation running',
  robotRunning: 'Robot running',
  // The resting half of a three-state indicator whose other two states are
  // "Simulation running" and "Robot running". It read "Idle": a systems word,
  // in an app whose users are told never to need one, and the only one of the
  // three that did not name its subject — so the indicator changed grammar,
  // not just value, every time a run started. "Not running" is the same
  // sentence with the same subject, negated.
  idle: 'Not running',
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
  // Distinct from unsavedChanges, which claims edits exist that are not on the
  // server. A task opened and not touched has none — "Unsaved changes" there
  // named a change the operator had not made, on the one screen whose whole
  // job is to tell them whether their work is safe.
  notSavedYet: 'Not saved yet',

  // Reusable-task concept — toolbox category, block label, and the action
  // that expands it all say "Saved Task" explicitly (never bare "macro",
  // which stays as the internal/code name only).
  savedTask: 'Saved Task',
  savedTasks: 'Saved Tasks',
  breakSavedTaskIntoSteps: 'Break Saved Task into steps',

  // The left blocks panel is always "Toolbox" — never "blocks sidebar".
  toolbox: 'Toolbox',
  // Copilot panel. "Copilot" is the product name and never varies; the rest
  // is what the operator reads around it.
  //
  // The panel used to carry a subtitle, "Ask for help with your task", one
  // line under a title that said COPILOT. It restated the title and cost the
  // header a row in a 360px column whose scarcest axis is vertical.
  copilot: 'Copilot',

  // Opening state. An operator who does not program reads "tell me what the
  // robot should do" as a blank page: the panel's only affordance was a text
  // field, and roughly half of it was empty. These label starters built from
  // the operator's own catalogue, so there is something to click rather than
  // something to compose.
  copilotStarters: 'Or start from one of these',

  // The automatic-review toggle. Its tooltip used to end "(uses tokens)" —
  // a billing concern belonging to whoever runs the server, written into the
  // one surface that belongs to the operator.
  copilotAutoCheckOn:
    'Automatic review is on — Copilot checks your task and points out what is missing',
  copilotAutoCheckOff:
    'Automatic review is off — Copilot answers only when you ask',
  copilotAutoCheckTurnOn: 'Turn on automatic review',
  copilotAutoCheckTurnOff: 'Turn off automatic review',
} as const
