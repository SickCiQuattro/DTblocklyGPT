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
        description:
          'Ripete un blocco di azioni per un numero definito di volte.',
        inputs: 'Numero di ripetizioni | Azioni da ripetere',
        outputs: 'Nessuno',
      },
      {
        type: 'loop_block',
        label: 'Loop',
        colour: blocksColours.logicControl,
      },
      {
        type: 'when_block',
        label: 'When … Do',
        colour: blocksColours.logicControl,
      },
      {
        type: 'when_otherwise_block',
        label: 'When … Do … Otherwise',
        colour: blocksColours.logicControl,
        description:
          'Valuta una condizione e sceglie automaticamente il ramo alternativo.',
        inputs: 'Condizione | Azione se vera | Azione se falsa',
        outputs: 'Nessuno',
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
        description:
          'Attiva la presa del robot per afferrare l’oggetto selezionato.',
        inputs: 'Oggetto target',
        outputs: 'Oggetto afferrato',
      },
      {
        type: 'place_block',
        label: 'Place',
        colour: blocksColours.robotActions,
      },
      {
        type: 'processing_block',
        label: 'Process',
        colour: blocksColours.robotActions,
      },
    ],
  },
  {
    key: 'human-actions',
    name: 'Human Actions',
    colour: blocksColours.humanActions,
    blocks: [
      {
        type: 'wait_for_human_block',
        label: 'Wait for human',
        colour: blocksColours.humanActions,
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
        type: 'sensor_signal_block',
        label: 'Sensor signal',
        colour: blocksColours.eventsConditions,
      },
      {
        type: 'find_object_block',
        label: 'Find object',
        colour: blocksColours.eventsConditions,
      },
      {
        type: 'human_feedback_block',
        label: 'Human feedback',
        colour: blocksColours.eventsConditions,
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
