/**
 * Keep this dictionary as the single source of truth for both:
 * - block tooltip strings in Blockly definitions
 * - block description strings in the custom toolbox UI
 */
export const blockDescriptionsByType = {
  find_object_block:
    'Checks if the camera can currently see the chosen object.',
  gesture_block:
    'Checks if the camera sees a specific hand gesture (like a thumbs up).',
  timer_block: 'Checks if the set amount of time has passed.',
  pick_block: 'Tells the robot to pick up the chosen object.',
  // MAPPING REFERENCE:
  // - processing_block ➔ Represents the 'Run Routine' visual block
  processing_block:
    'Makes the robot run a custom routine (like shaking or dispensing).',
  place_block: 'Tells the robot to place the object at the chosen destination.',
  move_to_block: 'Moves the robot to a specific location or safe area.',
  gripper_block: "Opens or closes the robot's gripper.",
  human_action_block:
    'Stops the robot and shows a message on screen. The robot waits for the chosen condition before resuming.',
  repeat_block: 'Repeats these steps a specific number of times.',
  when_block: 'Runs these steps once, when a specific condition becomes true.',
  when_otherwise_block:
    'When a condition is true, the robot does the first steps. When it is not, it does the second steps.',
  macro_task_block: 'Runs all the steps of a previously saved task.',
  repeat_until_block: 'Repeats these steps until a specific event happens.',
  notify_action_block:
    'Shows a message on screen while the robot keeps working. Use this to guide the person to prepare for the next step.',
  logic_and_block: 'True only when both conditions are true at the same time.',
  logic_or_block: 'True when at least one of the two conditions is true.',
  logic_not_block:
    'Reverses the result: true becomes false, false becomes true.',
  wait_block: 'Pauses the robot for a set number of seconds before continuing.',
  when_start:
    'This is the starting point of the program. Connect the first block below.',
} as const
