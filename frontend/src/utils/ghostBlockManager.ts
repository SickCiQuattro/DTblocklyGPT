import * as Blockly from 'blockly/core'

/**
 * CENTRALIZED MAP
 * Single source of truth: this map defines which blocks should receive
 * "ghost" (shadow) blocks and what type/label those shadows should have.
 */
export const GHOST_INPUT_MAP: Record<
  string,
  Record<string, { type: string; label: string }>
> = {
  when_start: {
    __next__: { type: 'shadow_start_sequence_block', label: 'Add first step' },
  },
  processing_block: {
    // MAPPING REFERENCE:
    // - ACTION input ➔ ghost shadow block label 'Select Routine...' (replaces Select Procedure)
    ACTION: { type: 'shadow_action_block', label: 'Select Routine...' },
  },
  pick_block: {
    OBJECT: { type: 'shadow_object_block', label: 'Select Object...' },
  },
  find_object_block: {
    OBJECT: { type: 'shadow_object_block', label: 'Select Object...' },
  },
  place_block: {
    // MAPPING REFERENCE:
    // - LOCATION input ➔ ghost shadow block label 'Select Location...' (replaces Select Destination)
    LOCATION: { type: 'shadow_location_block', label: 'Select Location...' },
  },
  move_to_block: {
    // MAPPING REFERENCE:
    // - LOCATION input ➔ ghost shadow block label 'Select Location...' (replaces Select Destination)
    LOCATION: { type: 'shadow_location_block', label: 'Select Location...' },
  },
  when_block: {
    WHEN: { type: 'shadow_trigger_block', label: 'Select Condition...' },
    DO: { type: 'shadow_sequence_block', label: 'Add a step...' },
  },
  when_otherwise_block: {
    WHEN: { type: 'shadow_trigger_block', label: 'Select Condition...' },
    DO: { type: 'shadow_sequence_block', label: 'Add a step...' },
    OTHERWISE: { type: 'shadow_sequence_block', label: 'Add a step...' },
  },
  repeat_until_block: {
    CONDITION: { type: 'shadow_trigger_block', label: 'Select Condition...' },
    DO: { type: 'shadow_sequence_block', label: 'Add a step...' },
  },
  human_action_block: {
    CONFIRM_EVENT: {
      type: 'shadow_trigger_block',
      label: 'Select Condition...',
    },
  },
  logic_and_block: {
    A: { type: 'shadow_trigger_block', label: 'Select Condition...' },
    B: { type: 'shadow_trigger_block', label: 'Select Condition...' },
  },
  logic_or_block: {
    A: { type: 'shadow_trigger_block', label: 'Select Condition...' },
    B: { type: 'shadow_trigger_block', label: 'Select Condition...' },
  },
  logic_not_block: {
    BOOL: { type: 'shadow_trigger_block', label: 'Select Condition...' },
  },
  repeat_block: {
    DO: { type: 'shadow_sequence_block', label: 'Add a step...' },
  },
  loop_block: {
    DO: { type: 'shadow_sequence_block', label: 'Add a step...' },
  },
}

/**
 * Set of block types identified as "ghosts".
 * Used to filter them out during serialization.
 */
export const GHOST_BLOCK_TYPES = new Set([
  'shadow_object_block',
  'shadow_location_block',
  'shadow_action_block',
  'shadow_trigger_block',
  'shadow_sequence_block',
  'shadow_start_sequence_block',
])

// --- UTILITY 1: STRIP GHOSTS FOR STORAGE --------------------------------------
type AnyBlockState = Record<string, unknown>

/**
 * Recursively removes ghost/shadow blocks from the block state object.
 * This prevents placeholder blocks from being permanently saved in the JSON/XML.
 */
function stripGhostsFromBlock(block: AnyBlockState): AnyBlockState {
  const inputs = block.inputs as Record<string, AnyBlockState> | undefined
  if (!inputs) return block

  const cleanedInputs: Record<string, AnyBlockState> = {}

  for (const [inputName, inputState] of Object.entries(inputs)) {
    const shadow = (inputState as AnyBlockState).shadow as
      | AnyBlockState
      | undefined
    const realBlock = (inputState as AnyBlockState).block as
      | AnyBlockState
      | undefined

    /**
     * Logic:
     * 1. Remove the shadow if its type is included in GHOST_BLOCK_TYPES.
     * 2. Recursively clean the real block if it exists.
     */
    cleanedInputs[inputName] = {
      ...inputState,
      ...(shadow && !GHOST_BLOCK_TYPES.has(shadow.type as string)
        ? { shadow }
        : { shadow: undefined }),
      ...(realBlock ? { block: stripGhostsFromBlock(realBlock) } : {}),
    }
  }

  // Handle the "next" block connection recursively
  const next = block.next as AnyBlockState | undefined
  const nextBlock = next?.block as AnyBlockState | undefined

  return {
    ...block,
    inputs: cleanedInputs,
    ...(next && nextBlock
      ? { next: { ...next, block: stripGhostsFromBlock(nextBlock) } }
      : {}),
  }
}

/**
 * Saves the workspace state while filtering out all ghost blocks.
 * Use this instead of the standard Blockly.serialization.workspaces.save().
 */
export function saveWorkspaceWithoutGhosts(
  workspace: Blockly.WorkspaceSvg,
): ReturnType<typeof Blockly.serialization.workspaces.save> {
  const state = Blockly.serialization.workspaces.save(workspace)

  if (!state.blocks?.blocks) return state

  return {
    ...state,
    blocks: {
      ...state.blocks,
      blocks: state.blocks.blocks.map(stripGhostsFromBlock),
    },
  }
}

// --- UTILITY 2: INJECT GHOST INTO AN EMPTY INPUT -----------------------------

/**
 * Creates and connects a ghost shadow block to a specific input if it's empty.
 */
function injectGhostBlock(
  workspace: Blockly.WorkspaceSvg,
  parentBlock: Blockly.Block,
  inputName: string,
  ghostDef: { type: string; label: string },
): boolean {
  const connection =
    inputName === '__next__'
      ? parentBlock.nextConnection
      : parentBlock.getInput(inputName)?.connection

  if (!connection || connection.targetBlock()) return false

  Blockly.Events.disable()
  try {
    const ghost = workspace.newBlock(ghostDef.type) as Blockly.BlockSvg
    ghost.setFieldValue(ghostDef.label, 'name')
    ghost.setShadow(true)
    ghost.initSvg()
    ghost.render()

    // shadow_sequence_block → previousConnection (statement input)
    // shadow_*_block (object/location/etc.) → outputConnection (value input)
    const ghostConnection =
      inputName === '__next__'
        ? ghost.previousConnection
        : (ghost.outputConnection ?? ghost.previousConnection)

    if (!ghostConnection) return false
    connection.connect(ghostConnection)
    return true
  } finally {
    Blockly.Events.enable()
  }
}
/**
 * Scans all blocks in the workspace and injects ghost blocks
 * wherever required inputs are empty. Call this after loading a task.
 */
export function injectAllGhostBlocks(workspace: Blockly.WorkspaceSvg): number {
  let injectedCount = 0
  workspace.getAllBlocks(false).forEach((block) => {
    // Note: getAllBlocks may return children before parents.
    // injectGhostBlock performs a targetBlock() check that makes it idempotent,
    // but in rare cases with nested structures, it might require a second pass.
    const inputMap = GHOST_INPUT_MAP[block.type]
    if (!inputMap) return
    Object.entries(inputMap).forEach(([inputName, ghostDef]) => {
      if (injectGhostBlock(workspace, block, inputName, ghostDef)) {
        injectedCount += 1
      }
    })
  })
  return injectedCount
}

// --- UTILITY 3: AUTOMATIC RESTORATION LISTENER -------------------------------

/**
 * Registers a change listener that re-injects ghost placeholders
 * whenever a real block is deleted or disconnected.
 * Returns a cleanup function to be called on component unmount.
 */
export function registerGhostRestoreListener(
  workspace: Blockly.WorkspaceSvg,
): () => void {
  let debounce: ReturnType<typeof setTimeout> | null = null

  const listener = (event: Blockly.Events.Abstract) => {
    // Only react to deletions or movements (disconnections)
    if (
      event.type !== Blockly.Events.BLOCK_DELETE &&
      event.type !== Blockly.Events.BLOCK_MOVE
    )
      return

    const moveEvent = event as Blockly.Events.BlockMove
    if (moveEvent.blockId) {
      const movedBlock = workspace.getBlockById(moveEvent.blockId)
      if (movedBlock?.isShadow()) return // Ignore moves of shadow blocks themselves
    }

    // Use a small debounce to avoid performance issues during rapid changes
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      Blockly.Events.setGroup('ghost-restore')
      try {
        const injectedCount = injectAllGhostBlocks(workspace)
        if (injectedCount > 0) {
          const anchorBlock = workspace.getTopBlocks(false)[0] ?? null
          if (anchorBlock) {
            const syntheticChange = new Blockly.Events.BlockChange(
              anchorBlock,
              'mutation',
              null,
              0,
              injectedCount,
            )
            syntheticChange.recordUndo = false
            syntheticChange.group = 'ghost-restore'
            workspace.fireChangeListener(syntheticChange)
          }
        }
      } finally {
        Blockly.Events.setGroup(false)
        debounce = null
      }
    }, 30)
  }

  workspace.addChangeListener(listener)

  // Return unsubscribe logic
  return () => {
    workspace.removeChangeListener(listener)
    if (debounce) clearTimeout(debounce)
  }
}
