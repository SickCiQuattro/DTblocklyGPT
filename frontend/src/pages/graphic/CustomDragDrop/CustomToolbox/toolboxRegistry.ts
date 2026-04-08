/**
 * toolboxRegistry.ts
 *
 * Static registry of toolbox categories and their block items.
 * This is the single source of truth for what appears in the custom
 * React toolbox sidebar. It is intentionally decoupled from Blockly's
 * runtime so the accordion can render independently of workspace lifecycle.
 */

import { blocksColours } from '../CustomBlocks'

// ─── Types ───────────────────────────────────────────────────────────────────

/** Represents a single draggable block item inside a toolbox category. */
export interface ToolboxBlockItem {
  /** Blockly block type identifier (must match a registered block definition). */
  type: string
  /** Human-readable label shown on the pill. */
  label: string
  /** Pill background colour — defaults to the parent category colour. */
  colour: string
  /** Optional contextual help shown in the rich tooltip card. */
  description?: string
  /** Optional textual summary of accepted inputs shown in the rich tooltip card. */
  inputs?: string
  /** Optional textual summary of produced outputs shown in the rich tooltip card. */
  outputs?: string
  /**
   * If true, this block is "dynamic" — its instances are generated at runtime
   * from external data (objects, locations, actions). The toolbox will render
   * one pill per data item instead of a single static pill.
   */
  dynamic?: boolean
  /** Default field values to set when the block is created (static blocks only). */
  fields?: Record<string, string | number | boolean>
  /** Optional serialized metadata for block.data (used by entity mutators/tooltips). */
  data?: string
}

/** Represents a collapsible category in the toolbox accordion. */
export interface ToolboxCategory {
  /** Unique key used as the accordion panel identifier. */
  key: string
  /** Display name shown in the category header. */
  name: string
  /** Category accent colour (used for the header indicator and default pill colour). */
  colour: string
  /** Static block items in this category. */
  blocks: ToolboxBlockItem[]
}

// ─── Static Category Definitions ─────────────────────────────────────────────

export const TOOLBOX_CATEGORIES: ToolboxCategory[] = [
  {
    key: 'logic-control',
    name: 'Logic / Control',
    colour: blocksColours.logicControl,
    blocks: [
      {
        type: 'repeat_block',
        label: 'Repeat N times',
        colour: blocksColours.logicControl,
        description: 'Repeats a block of actions for a specified number of times.',
        inputs: 'Number of repetitions | Actions to repeat',
        outputs: 'None',
      },
      {
        type: 'loop_block',
        label: 'Loop',
        colour: blocksColours.logicControl,
        description: 'Repeats actions indefinitely (useful for continuous sensory monitoring).',
        inputs: 'Actions to repeat',
        outputs: 'None',
      },
      {
        type: 'when_block',
        label: 'When … Do',
        colour: blocksColours.logicControl,
        description: 'Executes actions only if the specified condition is met.',
        inputs: 'Condition | Actions to execute',
        outputs: 'None',
      },
      {
        type: 'when_otherwise_block',
        label: 'When … Do … Otherwise',
        colour: blocksColours.logicControl,
        description: 'Evaluates a condition and automatically chooses the alternative branch (If-Else).',
        inputs: 'Condition | Actions if true | Actions if false',
        outputs: 'None',
      },
    ],
  },
  {
    key: 'robot-actions',
    name: 'Robot Actions',
    colour: blocksColours.robotActions,
    blocks: [
      {
        type: 'pick_block',
        label: 'Pick',
        colour: blocksColours.robotActions,
        description: 'Activates the robot\'s gripper to grasp the selected object.',
        inputs: 'Target object',
        outputs: 'None',
      },
      {
        type: 'place_block',
        label: 'Place',
        colour: blocksColours.robotActions,
        description: 'Places the currently held object at the specified destination.',
        inputs: 'Target location',
        outputs: 'None',
      },
      {
        type: 'move_to_block',
        label: 'Move To',
        colour: blocksColours.robotActions,
        description: 'Moves the robotic arm to a destination using linear or joint trajectories.',
        inputs: 'Motion type | Destination',
        outputs: 'None',
      },
      {
        type: 'move_relative_block',
        label: 'Move Relative',
        colour: blocksColours.robotActions,
        description: 'Moves the robot by a specific distance along a Cartesian axis (ideal for approaching or retreating from parts).',
        inputs: 'Axis (X, Y, Z) | Distance in mm',
        outputs: 'None',
      },
      {
        type: 'gripper_block',
        label: 'Gripper',
        colour: blocksColours.robotActions,
        description: 'Explicitly opens or closes the Cobotta\'s gripper.',
        inputs: 'State (Open/Close)',
        outputs: 'None',
      },
    ],
  },
  {
    key: 'human-actions',
    name: 'Human Actions',
    colour: blocksColours.humanActions,
    blocks: [
      {
        type: 'human_action_block',
        label: 'Human Action',
        colour: blocksColours.humanActions,
        description: 'Pauses the cobot to allow human intervention, resuming upon activation of the chosen trigger.',
        inputs: 'Task Description | Confirmation Method (Touch, UI, Gesture, Timer)',
        outputs: 'None',
      },
    ],
  },
  {
    key: 'objects-positions',
    name: 'Objects & Positions',
    colour: blocksColours.objectsPositions,
    blocks: [
      // Dynamic blocks — pills are generated from props (dataObjects, dataLocations, dataActions).
      // Each entry here acts as a "template"; the actual pills are rendered per data item.
      {
        type: 'object_block',
        label: 'Object',
        colour: blocksColours.objectsPositions,
        dynamic: true,
      },
      {
        type: 'location_block',
        label: 'Location',
        colour: blocksColours.objectsPositions,
        dynamic: true,
      },
      {
        type: 'action_block',
        label: 'Action',
        colour: blocksColours.objectsPositions,
        dynamic: true,
      },
    ],
  },
  {
    key: 'events-conditions',
    name: 'Events / Conditions',
    colour: blocksColours.eventsConditions,
    blocks: [
      {
        type: 'find_object_block',
        label: 'Find object',
        colour: blocksColours.eventsConditions,
        description: 'Searches for a specific object using the 3D vision system.',
        outputs: 'Boolean (True if found)',
      },
      {
        type: 'touch_detect_block',
        label: 'Touch Detect',
        colour: blocksColours.eventsConditions,
        description: 'Detects a physical touch or a torque peak on the Cobot\'s joints.',
        outputs: 'Boolean (True if touched)',
      },
      {
        type: 'gesture_block',
        label: 'Gesture Detect',
        colour: blocksColours.eventsConditions,
        description: 'Detects a specific hand gesture from the operator via camera.',
        outputs: 'Boolean (True if detected)',
      },
      {
        type: 'timer_block',
        label: 'Timer',
        colour: blocksColours.eventsConditions,
        description: 'Returns true when the specified time in seconds has elapsed.',
        inputs: 'Seconds',
        outputs: 'Boolean (True if elapsed)',
      },
      {
        type: 'sensor_signal_block',
        label: 'Sensor signal',
        colour: blocksColours.eventsConditions,
        description: 'Triggers when a generic external sensor signal is received.',
        outputs: 'Boolean (True if received)',
      },
    ],
  },
  {
    key: 'macro-tasks',
    name: 'Macro-tasks',
    colour: blocksColours.macroTasks,
    blocks: [
      // Empty for now — blocks will be added in a later phase.
    ],
  },
]