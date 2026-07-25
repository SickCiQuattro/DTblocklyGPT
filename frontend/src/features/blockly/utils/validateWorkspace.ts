import type { TaskTypeField } from 'pages/tasks/types'

export type WorkspaceError = {
  type: 'error'
  code: 'EMPTY_WORKSPACE' | 'NO_ROOT_BLOCK' | 'UNRESOLVED_ENTITY'
  message: string
  blockId?: string
}

export type WorkspaceWarning = {
  type: 'warning'
  code: 'FLOATING_BLOCK' | 'ORPHAN_MACRO_REF' | 'STALE_SIGNATURE'
  message: string
  blockId?: string
}

export type ValidationResult = {
  valid: boolean // false if at least one blocking error
  errors: WorkspaceError[]
  warnings: WorkspaceWarning[]
}

/**
 * Validates the serialized Blockly workspace.
 *
 * Blocking errors (prevent Save/Publish):
 *   - EMPTY_WORKSPACE: null or empty workspace
 *   - NO_ROOT_BLOCK: no recognizable root block
 *   - UNRESOLVED_ENTITY: block with data.id that does not correspond to any entity
 *
 * Non-blocking warnings (shown but do not prevent):
 *   - FLOATING_BLOCK: block disconnected from the main flow
 *   - ORPHAN_MACRO_REF: reference to an unpublished macro
 *   - STALE_SIGNATURE: macro signature in the block differs from the current one
 */
export const validateWorkspace = (
  workspace: Record<string, unknown> | null,
  taskType: TaskTypeField,
  options?: {
    knownMacroIds?: Set<number> // Available published macro IDs
    staleSignatureIds?: Set<number> // Macro IDs with changed signature
  },
): ValidationResult => {
  const errors: WorkspaceError[] = []
  const warnings: WorkspaceWarning[] = []

  // ── Blocking errors ───────────────────────────────────────────────────────

  if (workspace === null || Object.keys(workspace).length === 0) {
    errors.push({
      type: 'error',
      code: 'EMPTY_WORKSPACE',
      message: 'The workspace is empty. Add at least one block.',
    })
    return { valid: false, errors, warnings }
  }

  if (!workspace['type']) {
    errors.push({
      type: 'error',
      code: 'NO_ROOT_BLOCK',
      message: 'No root block found in the workspace.',
    })
  }

  // ── Non-blocking warnings ───────────────────────────────────────────────────

  // Floating blocks: present as a separate array (Blockly puts them in extras)
  const floatingBlocks = (workspace['__floating'] as unknown[]) ?? []
  floatingBlocks.forEach((b: any) => {
    warnings.push({
      type: 'warning',
      code: 'FLOATING_BLOCK',
      message: `Block "${b?.type ?? 'unknown'}" is not connected to the main flow.`,
      blockId: b?.id,
    })
  })

  // Orphan macro references / stale signature
  if (options?.knownMacroIds || options?.staleSignatureIds) {
    collectMacroRefs(workspace).forEach((ref) => {
      if (options?.knownMacroIds && !options.knownMacroIds.has(ref.id)) {
        warnings.push({
          type: 'warning',
          code: 'ORPHAN_MACRO_REF',
          message: `Saved task "${ref.name}" is not published and cannot be run.`,
          blockId: ref.blockId,
        })
      }
      if (options?.staleSignatureIds?.has(ref.id)) {
        warnings.push({
          type: 'warning',
          code: 'STALE_SIGNATURE',
          message: `Saved task "${ref.name}" has been updated — re-publish to use the latest version.`,
          blockId: ref.blockId,
        })
      }
    })
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

// ── Helper: collects all macro_task_block references in the workspace ───────

type MacroRef = { id: number; name: string; blockId?: string }

const collectMacroRefs = (
  node: Record<string, unknown>,
  refs: MacroRef[] = [],
): MacroRef[] => {
  if (node['type'] === 'macro_task_block' && node['data']) {
    try {
      const data =
        typeof node['data'] === 'string'
          ? JSON.parse(node['data'])
          : node['data']
      refs.push({ id: data.id, name: data.name, blockId: node['id'] as string })
    } catch {
      // malformed data — ignored
    }
  }

  // Recursion on inputs and next
  const inputs = node['inputs'] as Record<string, unknown> | undefined
  if (inputs) {
    Object.values(inputs).forEach((slot: any) => {
      if (slot?.block) collectMacroRefs(slot.block, refs)
    })
  }
  const next = node['next'] as { block?: Record<string, unknown> } | undefined
  if (next?.block) collectMacroRefs(next.block, refs)

  return refs
}
