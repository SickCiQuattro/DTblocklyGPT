import * as Blockly from 'blockly/core'

/**
 * Export / import the workspace as a JSON file (power-user backup & sharing).
 * Uses Blockly's native serialization, the same format persisted to the backend.
 */

const slugify = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'task'

/** Serialize the workspace and trigger a browser download of `<name>-<date>.json`. */
export const exportWorkspaceJson = (
  workspace: Blockly.WorkspaceSvg,
  name: string,
): void => {
  const state = Blockly.serialization.workspaces.save(workspace)
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const date = new Date().toISOString().slice(0, 10)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${slugify(name)}-${date}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/**
 * Replace the workspace contents with a serialized state. Throws if the text is
 * not valid Blockly JSON (caller shows a toast). Destructive — confirm first.
 */
export const importWorkspaceJson = (
  workspace: Blockly.WorkspaceSvg,
  jsonText: string,
): void => {
  const parsed = JSON.parse(jsonText) as Record<string, unknown>
  if (!parsed || typeof parsed !== 'object' || !('blocks' in parsed)) {
    throw new Error('Not a valid Blockly workspace file')
  }
  Blockly.serialization.workspaces.load(parsed, workspace)
}
