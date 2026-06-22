/**
 * blockCatalog.ts
 *
 * Flattens the toolbox registry into a compact catalog sent to the AI chat
 * (`dataBlocks` in the request). Keeping the catalog frontend-driven means the
 * chat always describes blocks with the exact names and descriptions the user
 * sees in the toolbox — no drift between the prompt and the UI.
 */

import { TOOLBOX_CATEGORIES } from './toolboxRegistry'

export interface ChatBlockCatalogItem {
  label: string
  description?: string
  inputs?: string
  dynamic?: boolean
}

export interface ChatBlockCatalogCategory {
  category: string
  blocks: ChatBlockCatalogItem[]
}

export const buildBlockCatalog = (): ChatBlockCatalogCategory[] =>
  TOOLBOX_CATEGORIES.map((cat) => ({
    category: cat.name,
    blocks: cat.blocks.map((b) => ({
      label: b.label,
      description: b.description,
      inputs: b.inputs,
      dynamic: b.dynamic,
    })),
  }))
