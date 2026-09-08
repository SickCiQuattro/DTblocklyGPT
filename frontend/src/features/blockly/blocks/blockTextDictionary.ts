/**
 * Keep these dictionaries as the single source of truth for:
 * - block tooltip strings in Blockly definitions
 * - block label + description strings in the custom toolbox UI
 * - block label + description strings in the Ctrl/Cmd+K search palette and the
 *   shadow-slot picker
 *
 * Labels were added here after the descriptions, for the same reason and after
 * the same failure. The toolbox and the search palette each kept their own
 * list, and they drifted apart on four of the twelve step blocks:
 *
 *   repeat_until_block    toolbox "Repeat"                 palette "Repeat until"
 *   when_block            toolbox "When → Do"              palette "When"
 *   when_otherwise_block  toolbox "When → Do / Otherwise"  palette "When / Otherwise"
 *   human_action_block    toolbox "Pause and show message" palette "Pause and show"
 *
 * The first one was not cosmetic. "Repeat until" is the exact phrasing the
 * block was deliberately renamed AWAY from — see definitions.ts, where the
 * canvas text became "Repeat / Do / Stop when" because operators read "repeat
 * until they press" and "repeat each time they press" equally readily when the
 * condition is an event. The palette went on offering the discarded name, so
 * the app taught the misreading on one surface and corrected it on another.
 */
export const blockLabelsByType = {
  // Task Flow. Both quote their own canvas rows; neither promises a word the
  // block does not contain.
  //
  // "Repeat until" stays out on purpose: the block reads "Repeat / Do / Stop
  // when", and with conditions phrased as events an operator reads "repeat
  // until they press" and "repeat each time they press" equally readily. That
  // is why the canvas says "Stop when", and a pill promising "until" would
  // break the scent between palette and canvas.
  //
  // But a bare "Repeat" beside "Repeat times" is one word apart, and the two
  // are adjacent in the same category. What actually separates them on the
  // canvas is the SLOT — a number field against a Boolean socket, which this
  // project draws with its own shape (see workspace/customRender.ts, where
  // thrasos_boolean gives every Boolean connection a dedicated tab, the same
  // trick Scratch's hexagon plays). The text pill throws that shape away, so
  // the palette is the one surface where the distinction is not visible.
  //
  // Naming the third row restores it using words already on the block, joined
  // with the arrow the two When pills in this category already use. One
  // joining mark, not two: an ellipsis here would have been a second device
  // doing the same job on the same four pills.
  //
  // The arrow appears exactly where a label carries on past the block's first
  // row. "Repeat 2 times" is complete in its first row — the Do body is what
  // every C-shaped block has — so it needs no continuation. A bare "Repeat" is
  // not complete: you have to keep reading to learn what ends it, which is the
  // whole reason this pill grew.
  //
  // "Do" is left out, and it was in a first version. Written as
  // "Repeat → Do → Stop when" it put a third "Do" into three consecutive
  // pills: every block in this category is C-shaped, so that word cannot tell
  // any of them apart — and it pushed "Stop when", which does, further right
  // where it is read later.
  //
  // The pill is a label for CHOOSING; the canvas is what teaches the shape.
  // Nothing is lost by not repeating there what the block shows the moment it
  // lands.
  //
  // The residual asymmetry is real and deliberate: the two When pills keep
  // their "Do". Against the rest of the toolbox — Pick up, Place at, Wait,
  // none of which hold anything — "→ Do" reads as "this one wraps steps", and
  // rewriting two labels that work, for symmetry alone, is churn. If it is
  // ever unified, unify by dropping: "When" and "When / Otherwise" discriminate
  // just as well.
  repeat_block: 'Repeat times',
  repeat_until_block: 'Repeat → Stop when',
  when_block: 'When → Do',
  when_otherwise_block: 'When → Do / Otherwise',

  // Robot Actions. "Execute skill" is the label for processing_block — the
  // type string stays processing_block everywhere in code.
  pick_block: 'Pick up',
  processing_block: 'Execute skill',
  place_block: 'Place at',
  move_to_block: 'Move to',
  open_gripper_block: 'Open gripper',
  close_gripper_block: 'Close gripper',
  wait_block: 'Wait',

  // Human Actions. Each quotes its own canvas text, and the difference lands
  // at the END of both, where the eye stops.
  //
  // The second used to read just "Show message", an ellipsis of its canvas
  // "Show message and continue:". It dropped the only words that separate it
  // from its twin, so the palette offered "Pause and show message" and "Show
  // message" — two message blocks differing by a prefix that is easy to skim
  // past, with the word that states the difference positively ("continue")
  // absent altogether.
  //
  // Blocking versus non-blocking is the distinction this whole category
  // exists for. Naming only one of the two for its effect is asymmetric.
  human_action_block: 'Pause and show message',
  notify_action_block: 'Show message and continue',

  // Conditions. All four name an EVENT, because that is what a condition is
  // here — something that happens, not a thing that exists. Three did already;
  // "Voice command" was a bare noun and the odd one out in a list of four read
  // top to bottom, while its own block on the canvas says "a voice command is
  // heard". The verb is what makes the row parallel to its neighbours and to
  // the block it creates.
  find_object_block: 'Object detected',
  gesture_block: 'Gesture detected',
  voice_command_block: 'Voice command heard',
  human_feedback_block: 'Confirm button pressed',

  // Deliberately absent, and each for its own reason:
  //
  // timer_block, logic_and/or/not_block — hidden from both the toolbox and the
  //   picker (relatrice feedback 2026-06-30). They are still reachable, since
  //   the chat assistant emits them, but nothing renders a NAME for them:
  //   collapsed blocks go through collapseSummary.ts, which builds its text
  //   from per-block functions rather than a label. Entries here would have no
  //   reader, and an unread string drifts silently.
  //
  // macro_task_block — has no single static name. The toolbox pill says
  //   UI_TEXT.savedTask because it is the category term; every row in the
  //   picker is named after the task the operator saved. Pinning one label
  //   would be wrong, not merely redundant.
  //
  // object_block, location_block, action_block — the toolbox shows plural
  //   headings ("Objects") that open a picker; the picker's rows are entity
  //   names from the database.
} as const

export const blockDescriptionsByType = {
  object_block:
    'One of the objects in your library — drop it into a step that needs to know which object.',
  location_block:
    'One of the places in your library — drop it into a step that needs to know where.',
  action_block:
    'One of the skills in your library — a movement the robot has already been taught.',
  find_object_block:
    'Checks if the camera can currently see the chosen object.',
  gesture_block:
    'Checks if the camera sees a specific hand gesture (like a thumbs up).',
  // The four words are the whole vocabulary, not examples — see
  // RECOGNIZED_VOICE_COMMANDS in constants/recognitionRegistry.ts. Naming two
  // of them "like yes or done" invites a fifth word that will never match.
  voice_command_block:
    'Checks if the operator says one of four words: yes, no, done, proceed.',
  timer_block: 'Checks if the set amount of time has passed.',
  // The trailing clause is the reason to choose this condition over the other
  // three, and it is the fallback when the camera or the microphone is
  // unavailable — worth the extra words.
  human_feedback_block:
    'Checks if the Confirm button in the robot panel has been pressed — no camera or microphone needed.',
  pick_block: 'Tells the robot to pick up the chosen object.',
  // MAPPING REFERENCE:
  // - processing_block ➔ Represents the 'Execute Skill' visual block
  processing_block:
    'Tells the robot to run a custom skill (like shaking or dispensing).',
  place_block: 'Tells the robot to place the object at the chosen destination.',
  move_to_block:
    'Tells the robot to move to a location, without picking anything up.',
  gripper_block: 'Tells the robot to open or close its gripper.',
  open_gripper_block:
    'Tells the robot to open its gripper and release what it is holding.',
  close_gripper_block:
    'Tells the robot to close its gripper and grip what is in front of it.',
  // One sentence, and it opens the same way its twin below does, so the
  // difference between the two lands where the eye stops rather than at the
  // start where they are identical.
  //
  // It was two sentences and named the robot in both — "Stops the robot and
  // shows a message on screen. The robot waits for the chosen condition before
  // resuming." At 292px, the width of the toolbox preview card, that wrapped
  // with "The" alone at the end of a line and "robot" beginning the next,
  // which reads as a paragraph break rather than as a wrap. Dropping the
  // repeated subject takes 24 characters out of the longest description in
  // this set and leaves nothing to strand.
  human_action_block:
    'Shows a message on screen and stops the robot until the chosen condition happens.',
  repeat_block: 'Repeats these steps a specific number of times.',
  when_block: 'Runs these steps once, when a specific condition becomes true.',
  when_otherwise_block:
    'Runs the first steps if the condition is true, otherwise runs the second steps.',
  macro_task_block: 'Runs all the steps of a previously saved task.',
  repeat_until_block:
    'Runs these steps, then checks. Repeats until the event happens, so the steps always run at least once.',
  notify_action_block:
    'Shows a message on screen while the robot keeps working. Use this to guide the person to prepare for the next step.',
  logic_and_block: 'True only when both conditions are true at the same time.',
  logic_or_block: 'True when at least one of the two conditions is true.',
  logic_not_block:
    'Reverses the result: true becomes false, false becomes true.',
  wait_block:
    'Tells the robot to wait a set number of seconds before continuing.',
  when_start:
    'This is the starting point of the program. Connect the first block below.',
} as const
