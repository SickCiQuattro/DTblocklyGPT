/**
 * Keep this dictionary as the single source of truth for both:
 * - block tooltip strings in Blockly definitions
 * - block description strings in the custom toolbox UI
 */
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
  voice_command_block:
    'Checks if the operator says a specific word (like "yes" or "done").',
  timer_block: 'Checks if the set amount of time has passed.',
  human_feedback_block:
    'Checks if the Confirm button in the robot panel has been pressed.',
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
  human_action_block:
    'Stops the robot and shows a message on screen. The robot waits for the chosen condition before resuming.',
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
