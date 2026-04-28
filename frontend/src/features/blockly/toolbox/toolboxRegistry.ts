/**
 * toolboxRegistry.ts
 *
 * Static registry of toolbox categories and their block items.
 * This is the single source of truth for what appears in the custom
 * React toolbox sidebar. It is intentionally decoupled from Blockly's
 * runtime so the accordion can render independently of workspace lifecycle.
 */

import { blockDescriptionsByType, blocksColours } from '../blocks'

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
  /** Optional serialized macro source code used for expanded macro preview. */
  macroCode?: string
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
    name: 'Task Flow', // Logic / Control -> Program Flow -> Task Flow
    colour: blocksColours.logicControl,
    blocks: [
      {
        type: 'repeat_block',
        label: 'Repeat times', // Repeat N Times
        colour: blocksColours.logicControl,
        description: blockDescriptionsByType.repeat_block,
        inputs: 'Number of repetitions | Steps to repeat',
        outputs: 'None',
      },
      {
        type: 'loop_block',
        label: 'Repeat forever', // Loop
        colour: blocksColours.logicControl,
        description: blockDescriptionsByType.loop_block,
        inputs: 'Steps to repeat',
        outputs: 'None',
      },
      {
        type: 'repeat_until_block',
        label: 'Repeat until',
        colour: blocksColours.logicControl,
        description: blockDescriptionsByType.repeat_until_block,
        inputs: 'Condition to stop | Steps to repeat',
        outputs: 'None',
      },
      {
        type: 'when_block',
        label: 'When → Do', // When … Do
        colour: blocksColours.logicControl,
        description: blockDescriptionsByType.when_block,
        inputs: 'Event to check | Steps to run',
        outputs: 'None',
      },
      {
        type: 'when_otherwise_block',
        label: 'When → Do / Otherwise', // When … Do … Otherwise
        colour: blocksColours.logicControl,
        description: blockDescriptionsByType.when_otherwise_block,
        inputs: 'Event to check | First set of steps | Second set of steps',
        outputs: 'None',
      },
    ],
  },
  {
    key: 'robot-actions',
    name: 'Robot Actions', // Robot Actions -> Robot Movements
    colour: blocksColours.robotActions,
    blocks: [
      {
        type: 'pick_block',
        label: 'Pick up', // Pick
        colour: blocksColours.robotActions,
        description: blockDescriptionsByType.pick_block,
        inputs: 'Target object',
        outputs: 'None',
      },
      {
        type: 'processing_block',
        label: 'Perform', // Process -> Execute Skill -> Perform
        colour: blocksColours.robotActions,
        description: blockDescriptionsByType.processing_block,
        inputs: 'Procedures',
        outputs: 'None',
      },
      {
        type: 'place_block',
        label: 'Place at', // Place
        colour: blocksColours.robotActions,
        description: blockDescriptionsByType.place_block,
        inputs: 'Target destination',
        outputs: 'None',
      },
      {
        type: 'move_to_block',
        label: 'Move to', // Move To
        colour: blocksColours.robotActions,
        description: blockDescriptionsByType.move_to_block,
        inputs: 'Motion type | Destination',
        outputs: 'None',
      },
      {
        type: 'gripper_block',
        label: 'Gripper', // Gripper
        colour: blocksColours.robotActions,
        description: blockDescriptionsByType.gripper_block,
        inputs: 'Action (Open/Close)',
        outputs: 'None',
      },
    ],
  },
  {
    key: 'human-actions',
    name: 'Human Step', // Human Actions -> Opeator Interaction
    colour: blocksColours.humanActions,
    blocks: [
      {
        type: 'human_action_block',
        label: 'Pause and wait', // Human Action -> Wait for Operator
        colour: blocksColours.humanActions,
        description: blockDescriptionsByType.human_action_block,
        inputs: 'Instruction for the person | Signal to wait for',
        outputs: 'None',
      },
    ],
  },
  {
    key: 'objects-positions',
    name: 'My Workspace', // Renamed from "Objects & Positions" // Variables & Entities
    colour: blocksColours.objectsPositions,
    blocks: [
      // Dynamic blocks — pills are generated from props (dataObjects, dataLocations, dataActions).
      // Each entry here acts as a "template"; the actual pills are rendered per data item.
      {
        type: 'object_block',
        label: 'Objects', // Object
        colour: blocksColours.objectsPositions,
        dynamic: true,
      },
      {
        type: 'location_block',
        label: 'Destinations', // Location
        colour: blocksColours.objectsPositions,
        dynamic: true,
      },
      {
        type: 'action_block',
        label: 'Procedures', // Action ->  Skill
        colour: blocksColours.objectsPositions,
        dynamic: true,
      },
    ],
  },
  {
    key: 'events-conditions',
    name: 'Conditions', // Events / Conditions -> Sensors & Triggers
    colour: blocksColours.eventsConditions,
    blocks: [
      {
        type: 'find_object_block',
        label: 'Object detected', // Find Object
        colour: blocksColours.eventsConditions,
        description: blockDescriptionsByType.find_object_block,
        outputs: 'Yes or No',
      },
      {
        type: 'touch_detect_block',
        label: 'Something touched', // Touch Detect
        colour: blocksColours.eventsConditions,
        description: blockDescriptionsByType.touch_detect_block,
        outputs: 'Yes or No',
      },
      {
        type: 'gesture_block',
        label: 'Gesture detected', // Gesture Detect
        colour: blocksColours.eventsConditions,
        description: blockDescriptionsByType.gesture_block,
        outputs: 'Yes or No',
      },
      {
        type: 'timer_block',
        label: 'Time passed', // Timer
        colour: blocksColours.eventsConditions,
        description: blockDescriptionsByType.timer_block,
        inputs: 'Seconds',
        outputs: 'Yes or No',
      },
      {
        type: 'sensor_signal_block',
        label: 'External signal received', // Sensor Signal
        colour: blocksColours.eventsConditions,
        description: blockDescriptionsByType.sensor_signal_block,
        outputs: 'Yes or No',
      },
    ],
  },
  {
    key: 'macro-tasks',
    name: 'My Tasks', // Macro-tasks -> saved Routines
    colour: blocksColours.macroTasks,
    blocks: [
      {
        type: 'macro_task_block',
        label: 'Do My Task', // Macro
        colour: blocksColours.macroTasks,
        dynamic: true,
      },
    ],
  },
]
