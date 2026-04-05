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
import TuneIcon from '@mui/icons-material/Tune'
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined'
import PersonOutlineOutlinedIcon from '@mui/icons-material/PersonOutlineOutlined'
import CategoryOutlinedIcon from '@mui/icons-material/CategoryOutlined'
import SensorsOutlinedIcon from '@mui/icons-material/SensorsOutlined'
import DashboardCustomizeOutlinedIcon from '@mui/icons-material/DashboardCustomizeOutlined'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'

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
  isDeleting: boolean
  onRootRefChange?: (element: HTMLElement | null) => void
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

const getCategoryIcon = (key: string, colour: string) => {
  const iconSx = {
    color: colour,
    fontSize: '1rem',
  }

  switch (key) {
    case 'logic-control':
      return <TuneIcon sx={iconSx} />
    case 'robot-actions':
      return <SmartToyOutlinedIcon sx={iconSx} />
    case 'human-actions':
      return <PersonOutlineOutlinedIcon sx={iconSx} />
    case 'objects-positions':
      return <CategoryOutlinedIcon sx={iconSx} />
    case 'events-conditions':
      return <SensorsOutlinedIcon sx={iconSx} />
    case 'macro-tasks':
      return <DashboardCustomizeOutlinedIcon sx={iconSx} />
    default:
      return <TuneIcon sx={iconSx} />
  }
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/** A single pill-shaped block item inside an expanded category. */
const BlockPill: React.FC<{
  item: ToolboxBlockItem
  categoryName: string
  onPointerDown: (
    e: React.PointerEvent<HTMLDivElement>,
    item: ToolboxBlockItem,
  ) => void
}> = ({ item, categoryName, onPointerDown }) => (
  <BlockPreviewTooltip item={item} categoryName={categoryName}>
    <div
      className="toolbox-pill"
      style={{ backgroundColor: item.colour }}
      onPointerDown={(e) => onPointerDown(e, item)}
      aria-label={item.label}
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
      expandIcon={<ExpandMoreIcon className="toolbox-category__chevron" />}
      className="toolbox-category__header"
      sx={{
        minHeight: '42px',
        '& .MuiAccordionSummary-content': { margin: '10px 0' },
      }}
    >
      <div className="toolbox-category__title">
        <span
          className="toolbox-category__accent"
          style={{ backgroundColor: category.colour }}
        />
        <span className="toolbox-category__icon" aria-hidden="true">
          {getCategoryIcon(category.key, category.colour)}
        </span>
        <Typography className="toolbox-category__name" title={category.name}>
          {category.name}
        </Typography>
      </div>
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
        <>
          {pills.map((pill, idx) => (
            <BlockPill
              key={`${pill.type}-${idx}`}
              item={pill}
              categoryName={category.name}
              onPointerDown={onBlockPointerDown}
            />
          ))}
          {/* Space */}
          <div style={{ height: '6px', flexShrink: 0, width: '100%' }} />
        </>
      )}
    </AccordionDetails>
  </Accordion>
)

// ─── Main Component ──────────────────────────────────────────────────────────

export const CustomToolbox: React.FC<CustomToolboxProps> = ({
  dataObjects,
  dataLocations,
  dataActions,
  isDeleting,
  onRootRefChange,
  onBlockPointerDown,
}) => {
  // Track which accordion panel is currently expanded (null = all collapsed).
  const [expandedKey, setExpandedKey] = useState<string | null>('logic-control')

  const handleAccordionChange = (key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key))
  }

  return (
    <aside className="custom-toolbox" ref={onRootRefChange}>
      <header
        className="custom-toolbox__header"
        style={
          isDeleting
            ? {
                backgroundColor: '#FEF2F2',
                borderBottom: '2px dashed #EF4444',
                transition: 'all 0.2s ease-in-out',
                paddingBottom: '4px',
              }
            : {
                transition: 'all 0.2s ease-in-out',
                borderBottom: '1px solid #E2E8F0',
              }
        }
      >
        <div className="custom-toolbox__header-content">
          <div className="custom-toolbox__header-title-row">
            <span
              className="custom-toolbox__header-label"
              style={isDeleting ? { color: '#991B1B' } : {}}
            >
              {isDeleting ? 'DELETE ZONE' : 'TOOLBOX'}
            </span>

            {isDeleting && (
              <span
                className="custom-toolbox__header-delete-badge"
                aria-hidden="true"
                style={{
                  display: 'inline-flex',
                  background: 'transparent',
                  backgroundColor: 'transparent',
                  border: 'none',
                  boxShadow: 'none',
                }}
              >
                <DeleteOutlineRoundedIcon
                  style={{
                    color: '#DC2626',
                    fontSize: '1.4rem',
                    background: 'transparent',
                    backgroundColor: 'transparent',
                  }}
                />
              </span>
            )}
          </div>

          <span
            className="custom-toolbox__header-subtitle"
            style={isDeleting ? { color: '#B91C1C', fontWeight: 600 } : {}}
          >
            {isDeleting
              ? 'Drop block here to remove'
              : 'Drag blocks into workspace'}
          </span>
        </div>
      </header>

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
        {/* Space */}
        <div style={{ height: '32px', flexShrink: 0, width: '100%' }} />
      </div>
    </aside>
  )
}
