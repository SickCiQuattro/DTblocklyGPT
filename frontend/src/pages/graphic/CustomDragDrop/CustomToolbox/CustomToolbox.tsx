/**
 * CustomToolbox.tsx
 *
 * A fully custom React toolbox that replaces the native Blockly SVG toolbox.
 * Renders an MUI Accordion sidebar with coloured pill-shaped block items.
 *
 * Phase 1: Static visual scaffold (no tooltips, no drag-and-drop).
 * Phase 2: Will add headless Blockly workspace tooltips on hover.
 * Phase 3: Will add HTML Drag & Drop → Blockly workspace bridge.
 */

import React, { useState } from 'react'
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'

import { ActionListType } from 'pages/actions/types'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'

import {
  TOOLBOX_CATEGORIES,
  ToolboxCategory,
  ToolboxBlockItem,
} from './toolboxRegistry'
import { BlockPreviewTooltip } from './BlockPreviewTooltip'
import './CustomToolbox.css'

// ─── Props ───────────────────────────────────────────────────────────────────

interface CustomToolboxProps {
  dataObjects: ObjectListType[]
  dataLocations: LocationListType[]
  dataActions: ActionListType[]
  onBlockPointerDown: (
    e: React.PointerEvent<HTMLDivElement>,
    item: ToolboxBlockItem,
  ) => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolves dynamic block templates into concrete pill items using live data.
 * Static blocks pass through unchanged.
 */
const resolveDynamicBlocks = (
  blocks: ToolboxBlockItem[],
  dataObjects: ObjectListType[],
  dataLocations: LocationListType[],
  dataActions: ActionListType[],
): ToolboxBlockItem[] => {
  const toKeywordsCsvOrNull = (keywords: string[] | null | undefined) => {
    if (!Array.isArray(keywords) || keywords.length === 0) {
      return null
    }

    const normalized = keywords
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length > 0)

    return normalized.length > 0 ? normalized.join(',') : null
  }

  const buildEntityData = (
    id: number,
    name: string,
    keywords: string[] | null | undefined,
  ) => {
    return JSON.stringify({
      id,
      name,
      keywords: toKeywordsCsvOrNull(keywords),
    })
  }

  const resolved: ToolboxBlockItem[] = []

  for (const block of blocks) {
    if (!block.dynamic) {
      resolved.push(block)
      continue
    }

    switch (block.type) {
      case 'object_block':
        dataObjects.forEach((obj) => {
          const displayName = obj.name?.trim() || `Object ${obj.id}`

          resolved.push({
            type: 'object_block',
            label: displayName,
            colour: block.colour,
            // object_block uses a serializable label field named "name".
            fields: { name: displayName },
            // Mutator metadata is read from block.data (id is required for warning state).
            data: buildEntityData(obj.id, displayName, obj.keywords),
          })
        })
        break

      case 'location_block':
        dataLocations.forEach((loc) => {
          const displayName = loc.name?.trim() || `Location ${loc.id}`

          resolved.push({
            type: 'location_block',
            label: displayName,
            colour: block.colour,
            // location_block uses a serializable label field named "name".
            fields: { name: displayName },
            data: buildEntityData(loc.id, displayName, loc.keywords),
          })
        })
        break

      case 'action_block':
        dataActions.forEach((act) => {
          const displayName = act.name?.trim() || `Action ${act.id}`

          resolved.push({
            type: 'action_block',
            label: displayName,
            colour: block.colour,
            // action_block uses a serializable label field named "name".
            fields: { name: displayName },
            data: buildEntityData(act.id, displayName, act.keywords),
          })
        })
        break

      default:
        resolved.push(block)
    }
  }

  return resolved
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/** A single pill-shaped block item inside an expanded category. */
const BlockPill: React.FC<{
  item: ToolboxBlockItem
  onPointerDown: (
    e: React.PointerEvent<HTMLDivElement>,
    item: ToolboxBlockItem,
  ) => void
}> = ({ item, onPointerDown }) => (
  <BlockPreviewTooltip item={item}>
    <div
      className="toolbox-pill"
      style={{ backgroundColor: item.colour }}
      onPointerDown={(e) => onPointerDown(e, item)}
      title={item.label}
    >
      <span className="toolbox-pill__label">{item.label}</span>
    </div>
  </BlockPreviewTooltip>
)

/** A single accordion category with its child pills. */
const CategoryPanel: React.FC<{
  category: ToolboxCategory
  pills: ToolboxBlockItem[]
  expanded: boolean
  onChange: (key: string) => void
  onBlockPointerDown: (
    e: React.PointerEvent<HTMLDivElement>,
    item: ToolboxBlockItem,
  ) => void
}> = ({ category, pills, expanded, onChange, onBlockPointerDown }) => (
  <Accordion
    expanded={expanded}
    onChange={() => onChange(category.key)}
    disableGutters
    elevation={0}
    className="toolbox-category"
    sx={{
      '&::before': { display: 'none' }, // Remove MUI default divider
    }}
  >
    <AccordionSummary
      expandIcon={<ExpandMoreIcon sx={{ color: '#fff' }} />}
      className="toolbox-category__header"
      sx={{
        backgroundColor: category.colour,
        borderRadius: expanded ? '8px 8px 0 0' : '8px',
        transition: 'border-radius 0.2s ease',
        minHeight: '40px',
        '& .MuiAccordionSummary-content': { margin: '8px 0' },
      }}
    >
      <Typography
        sx={{
          color: '#fff',
          fontWeight: 600,
          fontSize: '0.85rem',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          letterSpacing: '0.01em',
        }}
      >
        {category.name}
      </Typography>
    </AccordionSummary>

    <AccordionDetails className="toolbox-category__body">
      {pills.length === 0 ? (
        <Typography
          variant="caption"
          sx={{ color: '#94A3B8', fontStyle: 'italic', padding: '4px 0' }}
        >
          No blocks available
        </Typography>
      ) : (
        pills.map((pill, idx) => (
          <BlockPill
            key={`${pill.type}-${idx}`}
            item={pill}
            onPointerDown={onBlockPointerDown}
          />
        ))
      )}
    </AccordionDetails>
  </Accordion>
)

// ─── Main Component ──────────────────────────────────────────────────────────

export const CustomToolbox: React.FC<CustomToolboxProps> = ({
  dataObjects,
  dataLocations,
  dataActions,
  onBlockPointerDown,
}) => {
  // Track which accordion panel is currently expanded (null = all collapsed).
  const [expandedKey, setExpandedKey] = useState<string | null>('logic-control')

  const handleAccordionChange = (key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key))
  }

  return (
    <aside className="custom-toolbox">
      <div className="custom-toolbox__scroll">
        {TOOLBOX_CATEGORIES.map((category) => {
          const pills = resolveDynamicBlocks(
            category.blocks,
            dataObjects,
            dataLocations,
            dataActions,
          )

          return (
            <CategoryPanel
              key={category.key}
              category={category}
              pills={pills}
              expanded={expandedKey === category.key}
              onChange={handleAccordionChange}
              onBlockPointerDown={onBlockPointerDown}
            />
          )
        })}
      </div>
    </aside>
  )
}
