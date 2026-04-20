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
  pick_block: 'Tells the robot to grab the chosen object.',
  processing_block:
    'Makes the robot perform a specific skill (like scanning or welding) on the object.',
  place_block:
    'Tells the robot to release the object at the chosen destination.',
  move_to_block: 'Moves the robot to a specific location or safe area.',
  move_relative_block:
    'Shifts the robot slightly up, down, or sideways from where it is right now.',
  gripper_block: "Opens or closes the robot's gripper.",
  human_action_block:
    'Stops the robot so a person can safely do a task. The robot waits for a signal before moving again.',
  repeat_block: 'Repeats these steps a specific number of times.',
  loop_block: 'Repeats these steps forever until you tell the robot to stop.',
  when_block: 'Runs these steps only if a specific event happens.',
  when_otherwise_block:
    'If a specific event happens, the robot does the first set of steps. If not, it does the second set.',
  macro_task_block: 'Runs all the steps inside a previously saved routine.',
} as const
