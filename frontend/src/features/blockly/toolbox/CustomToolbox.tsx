import React, { useState } from 'react'
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'
import {
  Blocks,
  ChevronDown,
  Bot,
  User,
  Repeat2,
  Waypoints,
  ScanEye,
  Workflow,
  Trash2,
  PanelLeft,
} from 'lucide-react'

import { ActionListType } from 'pages/actions/types'
import { LocationListType } from 'pages/locations/types'
import { ObjectListType } from 'pages/objects/types'
import { TaskDetailType, TaskType } from 'pages/tasks/types'

import { buildEntityData } from '../utils/keywords'
import { type BlockViewMode } from '../utils/useViewSettings'

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
  dataMacros: TaskType[]
  isDeleting: boolean
  deleteZoneState?: 'idle' | 'drag-intent' | 'hover-confirm'
  blockViewMode?: BlockViewMode
  macroDetailsById: Record<number, TaskDetailType>
  onRootRefChange?: (element: HTMLElement | null) => void
  /** Hide the toolbox (the "show" button then lives on the workspace overlay). */
  onCollapse?: () => void
  onBlockPointerDown: (
    e: React.PointerEvent<HTMLDivElement>,
    item: ToolboxBlockItem,
  ) => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Expand each dynamic block template in a category into one concrete
 * `ToolboxBlockItem` per data entity (object, location, action, or macro).
 * Static (non-dynamic) items are passed through unchanged.
 */
const resolveDynamicBlocks = (
  blocks: ToolboxBlockItem[],
  dataObjects: ObjectListType[],
  dataLocations: LocationListType[],
  dataActions: ActionListType[],
  dataMacros: TaskType[],
  macroDetailsById: Record<number, TaskDetailType>,
): ToolboxBlockItem[] => {
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
            fields: { name: displayName },
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
            fields: { name: displayName },
            data: buildEntityData(act.id, displayName, act.keywords),
          })
        })
        break

      case 'macro_task_block':
        dataMacros.forEach((macro) => {
          const displayName = macro.name?.trim() || `Task ${macro.id}`
          const detail = macroDetailsById[macro.id]
          const summary =
            macro.description?.trim() && macro.description.trim().length > 0
              ? macro.description.trim()
              : 'No description available.'

          resolved.push({
            type: 'macro_task_block',
            label: displayName,
            colour: block.colour,
            fields: { name: displayName },
            data: JSON.stringify({ id: macro.id, name: displayName }),
            macroCode:
              detail?.code != null ? JSON.stringify(detail.code) : undefined,
            description: summary,
            inputs: 'None',
            outputs: 'Sequence Execution',
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
  // Lucide (16px = 1rem)
  const size = 16

  switch (key) {
    case 'logic-control':
      // Neutral "flow of steps" — the category holds both loops and conditionals.
      return <Waypoints color={colour} size={size} />
    case 'robot-actions':
      return <Bot color={colour} size={size} />
    case 'human-actions':
      return <User color={colour} size={size} />
    case 'objects-positions':
      return <Blocks color={colour} size={size} />
    case 'events-conditions':
      return <ScanEye color={colour} size={size} />
    case 'macro-tasks':
      return <Workflow color={colour} size={size} />
    default:
      return <Repeat2 color={colour} size={size} />
  }
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const BlockPill: React.FC<{
  item: ToolboxBlockItem
  categoryName: string
  categoryColour: string
  blockViewMode: BlockViewMode
  onPointerDown: (
    e: React.PointerEvent<HTMLDivElement>,
    item: ToolboxBlockItem,
  ) => void
}> = ({ item, categoryName, categoryColour, blockViewMode, onPointerDown }) => {
  const theme = useTheme()
  return (
    <BlockPreviewTooltip
      item={item}
      categoryName={categoryName}
      categoryColour={categoryColour}
      blockViewMode={blockViewMode}
    >
      <div
        className="toolbox-pill"
        style={{
          backgroundColor: theme.palette.background.paper,
          borderLeft: `3px solid ${item.colour}`,
        }}
        onPointerDown={(e) => onPointerDown(e, item)}
        aria-label={item.label}
      >
        <span className="toolbox-pill__label">{item.label}</span>
      </div>
    </BlockPreviewTooltip>
  )
}

type CategoryTabKey = 'objects' | 'positions' | 'actions'

interface CategoryTabDefinition {
  key: CategoryTabKey
  label: string
  blockTypes: string[]
}

// MAPPING REFERENCE:
// - key: 'positions' ➔ User-facing label: 'Locations' (maps to location_block)
// - key: 'actions' ➔ User-facing label: 'Skills' (maps to action_block)
const OBJECT_POSITION_TABS: CategoryTabDefinition[] = [
  {
    key: 'objects',
    label: 'Objects',
    blockTypes: ['object_block'],
  },
  {
    key: 'positions',
    label: 'Locations',
    blockTypes: ['location_block'],
  },
  {
    key: 'actions',
    label: 'Skills',
    blockTypes: ['action_block'],
  },
]

const CategoryPanel: React.FC<{
  category: ToolboxCategory
  pills: ToolboxBlockItem[]
  blockViewMode: BlockViewMode
  expanded: boolean
  onChange: (key: string) => void
  onBlockPointerDown: (
    e: React.PointerEvent<HTMLDivElement>,
    item: ToolboxBlockItem,
  ) => void
}> = ({
  category,
  pills,
  blockViewMode,
  expanded,
  onChange,
  onBlockPointerDown,
}) => {
  const theme = useTheme()
  const isObjectsPositionsCategory = category.key === 'objects-positions'
  const [activeTab, setActiveTab] = useState<CategoryTabKey>('objects')

  const activeTabConfig = isObjectsPositionsCategory
    ? OBJECT_POSITION_TABS.find((tab) => tab.key === activeTab)
    : null

  const visiblePills = activeTabConfig
    ? pills.filter((pill) => activeTabConfig.blockTypes.includes(pill.type))
    : pills

  const showCategoryIcons = true

  return (
    <Accordion
      expanded={expanded}
      onChange={() => onChange(category.key)}
      disableGutters
      elevation={0}
      className="toolbox-category"
      sx={{
        '&::before': { display: 'none' },
      }}
    >
      <AccordionSummary
        expandIcon={<ChevronDown className="toolbox-category__chevron" />}
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
          {showCategoryIcons && (
            <span className="toolbox-category__icon" aria-hidden="true">
              {getCategoryIcon(category.key, category.colour)}
            </span>
          )}
          <Typography className="toolbox-category__name" title={category.name}>
            {category.name}
          </Typography>
        </div>
      </AccordionSummary>

      <AccordionDetails className="toolbox-category__body">
        {isObjectsPositionsCategory && (
          <div
            className="toolbox-category-tabs"
            role="tablist"
            aria-label={`${category.name} tabs`}
          >
            {OBJECT_POSITION_TABS.map((tab) => {
              const isActive = activeTab === tab.key
              const stateClass = isActive
                ? 'toolbox-category-tab--active'
                : 'toolbox-category-tab--inactive'

              return (
                <button
                  key={tab.key}
                  type="button"
                  className={[
                    'toolbox-category-tab',
                    `toolbox-category-tab--${tab.key}`,
                    stateClass,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setActiveTab(tab.key)}
                  role="tab"
                  aria-selected={isActive}
                >
                  <span className="toolbox-category-tab__label">
                    {tab.label}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {visiblePills.length === 0 ? (
          <Typography
            variant="caption"
            sx={{
              color: theme.palette.slate[400],
              fontStyle: 'italic',
              padding: '4px 0',
            }}
          >
            No blocks available
          </Typography>
        ) : (
          <>
            {visiblePills.map((pill) => (
              <BlockPill
                key={`${category.key}-${pill.type}-${pill.label}-${pill.data ?? ''}`}
                item={pill}
                categoryName={category.name}
                categoryColour={category.colour}
                blockViewMode={blockViewMode}
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
}

// ─── Main Component ──────────────────────────────────────────────────────────

export const CustomToolbox: React.FC<CustomToolboxProps> = ({
  dataObjects,
  dataLocations,
  dataActions,
  dataMacros,
  isDeleting,
  deleteZoneState = 'idle',
  blockViewMode = 'complete',
  onRootRefChange,
  onCollapse,
  onBlockPointerDown,
  macroDetailsById,
}) => {
  const theme = useTheme()
  const [expandedKey, setExpandedKey] = useState<string | null>('logic-control')

  const handleAccordionChange = (key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key))
  }

  return (
    <aside
      className="custom-toolbox"
      data-view-mode={blockViewMode}
      ref={onRootRefChange}
    >
      <header
        className="custom-toolbox__header"
        style={
          /*isDeleting
            ? {
                backgroundColor: '#FEF2F2',
                borderBottom: '2px dashed #C84D28',
                transition: 'all 0.2s ease-in-out',
                paddingBottom: '4px',
              }
            : */ {
            transition: 'all 0.2s ease-in-out',
            borderBottom: `1px solid ${theme.palette.slate[200]}`,
          }
        }
      >
        <div className="custom-toolbox__header-content">
          <div className="custom-toolbox__header-title-row">
            <span
              className="custom-toolbox__header-label"
              style={isDeleting ? { color: theme.palette.accent.dark } : {}}
            >
              {isDeleting ? 'DELETE ZONE' : 'TOOLBOX'}
            </span>

            {/*isDeleting && (
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
                <Trash2
                  color="#C84D28"
                  size={22}
                  style={{
                    background: 'transparent',
                    backgroundColor: 'transparent',
                  }}
                />
              </span>
            )*/}
          </div>

          <span
            className="custom-toolbox__header-subtitle"
            style={
              isDeleting
                ? { color: theme.palette.accent.dark, fontWeight: 600 }
                : {}
            }
          >
            {isDeleting ? 'Drop block to remove' : 'Drag blocks into workspace'}
          </span>
        </div>

        {onCollapse && !isDeleting && (
          <Tooltip title="Collapse blocks sidebar">
            <IconButton
              size="small"
              onClick={onCollapse}
              aria-label="Collapse blocks sidebar"
              sx={{
                flexShrink: 0,
                width: 30,
                height: 30,
                borderRadius: '8px',
                color: theme.palette.slate[600],
                '&:hover': {
                  backgroundColor: theme.palette.primary.lighter,
                  color: theme.palette.primary.main,
                },
              }}
            >
              <PanelLeft size={18} />
            </IconButton>
          </Tooltip>
        )}
      </header>

      <div className="custom-toolbox__scroll">
        {TOOLBOX_CATEGORIES.map((category) => {
          const pills = resolveDynamicBlocks(
            category.blocks,
            dataObjects,
            dataLocations,
            dataActions,
            dataMacros,
            macroDetailsById,
          )

          return (
            <CategoryPanel
              key={category.key}
              category={category}
              pills={pills}
              blockViewMode={blockViewMode}
              expanded={expandedKey === category.key}
              onChange={handleAccordionChange}
              onBlockPointerDown={onBlockPointerDown}
            />
          )
        })}
      </div>
      {isDeleting && (
        <div
          className={`custom-toolbox__delete-overlay custom-toolbox__delete-overlay--${deleteZoneState}`}
          role="status"
          aria-live="polite"
        >
          <div className="custom-toolbox__delete-overlay-content">
            <Trash2
              size={48}
              className="custom-toolbox__delete-overlay-icon"
              aria-hidden="true"
            />
            <p className="custom-toolbox__delete-overlay-text">
              {deleteZoneState === 'hover-confirm'
                ? 'Release to delete'
                : 'Drop here to remove'}
            </p>
          </div>
        </div>
      )}
    </aside>
  )
}
