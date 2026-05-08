/**
 * keywords.ts
 *
 * Shared helpers for normalising and serialising keyword arrays.
 * Used by both the toolbox block resolver (CustomToolbox) and the
 * shadow picker item catalog (shadowPicker/catalog.ts).
 *
 * Centralising these here eliminates the duplication that previously
 * existed between BlocklyEditor.tsx and CustomToolbox.tsx.
 */

/**
 * Trim each keyword in the array and drop any empty strings.
 *
 * @param keywords Raw keyword strings (may contain whitespace or empty entries).
 * @returns        Cleaned array with no empty or whitespace-only entries.
 */
export const normalizeKeywords = (keywords: string[]): string[] =>
  keywords.map((k) => k.trim()).filter((k) => k.length > 0)

/**
 * Join a keyword array into a comma-separated string for storage inside
 * `block.data`, or return `null` when the list is empty.
 *
 * @param keywords Raw or pre-normalized keyword strings.
 * @returns        Comma-separated string, or `null` if no valid keywords exist.
 */
export const toKeywordsCsvOrNull = (keywords: string[]): string | null => {
  const normalized = normalizeKeywords(keywords)
  return normalized.length > 0 ? normalized.join(',') : null
}

/**
 * Serialize entity metadata (id, name, optional keywords) into the JSON
 * string expected by block.data for entity blocks and the entity mutators.
 *
 * @param id       Numeric entity ID from the backend.
 * @param name     Display name of the entity.
 * @param keywords Optional keyword array for search / tooltip.
 * @returns        JSON string `{ id, name, keywords }`.
 */
export const buildEntityData = (
  id: number,
  name: string,
  keywords: string[] | null | undefined,
): string =>
  JSON.stringify({
    id,
    name,
    keywords: toKeywordsCsvOrNull(Array.isArray(keywords) ? keywords : []),
  })
