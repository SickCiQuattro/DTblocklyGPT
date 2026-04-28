/**
 * Keep this dictionary as the single source of truth for both:
 * - block tooltip strings in Blockly definitions
 * - block description strings in the custom toolbox UI
 */
export const blockDescriptionsByType = {
  sensor_signal_block:
    'Checks if a connected external machine or sensor is sending a signal.',
  find_object_block:
    'Checks if the camera can currently see the chosen object.',
  touch_detect_block: 'Checks if someone or something is touching the robot.',
  gesture_block:
    'Checks if the camera sees a specific hand gesture (like a thumbs up).',
  timer_block: 'Checks if the set amount of time has passed.',
  pick_block: 'Tells the robot to pick up the chosen object.',
  processing_block:
    'Makes the robot perform a custom action (like shaking or dispensing).',
  place_block: 'Tells the robot to place the object at the chosen destination.',
  move_to_block: 'Moves the robot to a specific location or safe area.',
  gripper_block: "Opens or closes the robot's gripper.",
  human_action_block:
    'Stops the robot so a person can safely do a task. The robot waits for a signal before moving again.',
  repeat_block: 'Repeats these steps a specific number of times.',
  loop_block: 'Repeats these steps continuously, without stopping on its own.',
  when_block: 'Runs these steps once, when a specific condition becomes true.',
  when_otherwise_block:
    'When a condition is true, the robot does the first steps. When it is not, it does the second steps.',
  macro_task_block: 'Runs all the steps of a previously saved task.',
  repeat_until_block: 'Repeats these steps until a specific event happens.',
} as const
