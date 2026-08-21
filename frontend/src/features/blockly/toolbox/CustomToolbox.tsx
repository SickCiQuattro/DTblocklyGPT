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
import { UI_TEXT } from 'constants/uiVocabulary'

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
  /** Stays mounted (for its own width transition) — this drives the collapsed state. */
  collapsed: boolean
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
  /** Keyboard equivalent of dragging a pill — Enter/Space on a focused pill. */
  onBlockActivate: (item: ToolboxBlockItem) => void
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
            // Same as every other step block ("Repeat times", "Pick up",
            // ...) — it runs, it doesn't hand back data. "Sequence
            // Execution" was the only block in the toolbox describing
            // itself in implementation terms instead of this plain "None".
            outputs: 'None',
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
  onActivate: (item: ToolboxBlockItem) => void
  /** DOM id, so the arrow handler can move focus without a ref per pill. */
  domId: string
  /** Roving tabindex: only the active pill of a category is a Tab stop. */
  isTabStop: boolean
  /** Move the active pill by `step` within this category. */
  onArrow: (step: number) => void
}> = ({
  item,
  categoryName,
  categoryColour,
  blockViewMode,
  onPointerDown,
  onActivate,
  domId,
  isTabStop,
  onArrow,
}) => {
  const theme = useTheme()
  return (
    <BlockPreviewTooltip
      item={item}
      categoryName={categoryName}
      categoryColour={categoryColour}
      blockViewMode={blockViewMode}
    >
      <div
        id={domId}
        className="toolbox-pill"
        style={{
          backgroundColor: theme.palette.background.paper,
          borderLeft: `3px solid ${item.colour}`,
        }}
        onPointerDown={(e) => onPointerDown(e, item)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            onArrow(e.key === 'ArrowDown' ? 1 : -1)
            return
          }
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          onActivate(item)
        }}
        role="button"
        // Roving tabindex. Every pill used to be its own Tab stop, so reaching
        // the last category meant pressing Tab dozens of times; now the whole
        // list is one stop and the arrows move inside it.
        tabIndex={isTabStop ? 0 : -1}
        aria-label={`Add ${item.label} to the task`}
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

/** Arrow keys that move within the tablist, and which way. */
const ARROW_STEP: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 }

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
  onBlockActivate: (item: ToolboxBlockItem) => void
}> = ({
  category,
  pills,
  blockViewMode,
  expanded,
  onChange,
  onBlockPointerDown,
  onBlockActivate,
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

  // Which pill of this category currently holds the Tab stop. Clamped rather
  // than reset, so switching the Objects/Locations/Skills tab (which changes
  // the visible list) cannot leave the stop pointing past the end — with no
  // pill carrying tabIndex=0 the whole category would drop out of the tab
  // order.
  const [activePill, setActivePill] = useState(0)
  const pillTabStop = Math.min(activePill, Math.max(0, visiblePills.length - 1))

  const movePillFocus = (from: number, step: number) => {
    if (visiblePills.length === 0) return
    const next = (from + step + visiblePills.length) % visiblePills.length
    setActivePill(next)
    document.getElementById(`${category.key}-pill-${next}`)?.focus()
  }

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
        // Focus target for the T shortcut (jump into the palette) and for
        // H / Shift+H (walk the categories), both of which move focus by id.
        id={`toolbox-category-${category.key}`}
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
            {OBJECT_POSITION_TABS.map((tab, index) => {
              const isActive = activeTab === tab.key
              const stateClass = isActive
                ? 'toolbox-category-tab--active'
                : 'toolbox-category-tab--inactive'

              return (
                <button
                  key={tab.key}
                  id={`${category.key}-tab-${tab.key}`}
                  type="button"
                  className={[
                    'toolbox-category-tab',
                    `toolbox-category-tab--${tab.key}`,
                    stateClass,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setActiveTab(tab.key)}
                  // Roving tabindex: the tablist is ONE tab stop, and the
                  // arrows move within it. Leaving every tab tabbable is what
                  // made the arrows look broken — role="tab" tells a keyboard
                  // or screen-reader user that arrows are the way to move, so
                  // the role was promising behaviour the code did not have.
                  tabIndex={isActive ? 0 : -1}
                  onKeyDown={(e) => {
                    const last = OBJECT_POSITION_TABS.length - 1
                    const step = ARROW_STEP[e.key] ?? 0
                    let next = -1
                    if (step !== 0) {
                      next = (index + step + last + 1) % (last + 1)
                    } else if (e.key === 'Home') {
                      next = 0
                    } else if (e.key === 'End') {
                      next = last
                    }
                    if (next < 0) return
                    e.preventDefault()
                    const target = OBJECT_POSITION_TABS[next]
                    setActiveTab(target.key)
                    // Selection follows focus (the ARIA pattern for tabs whose
                    // panels are cheap to render), so focus has to move too or
                    // the next arrow press would start from the old tab.
                    document
                      .getElementById(`${category.key}-tab-${target.key}`)
                      ?.focus()
                  }}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`${category.key}-tabpanel`}
                >
                  <span className="toolbox-category-tab__label">
                    {tab.label}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* The pills are the tab panel when this category has tabs, so the
            tablist above has something to point `aria-controls` at. The
            wrapper repeats the column layout of `.toolbox-category__body`
            because it becomes a flex item of it. Categories without tabs get
            no wrapper and no role: a tabpanel with no tablist is worse than
            none. */}
        <div
          {...(isObjectsPositionsCategory
            ? {
                role: 'tabpanel',
                id: `${category.key}-tabpanel`,
                'aria-labelledby': `${category.key}-tab-${activeTab}`,
              }
            : {})}
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
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
              {visiblePills.map((pill, index) => (
                <BlockPill
                  key={`${category.key}-${pill.type}-${pill.label}-${pill.data ?? ''}`}
                  item={pill}
                  categoryName={category.name}
                  categoryColour={category.colour}
                  blockViewMode={blockViewMode}
                  onPointerDown={onBlockPointerDown}
                  onActivate={onBlockActivate}
                  domId={`${category.key}-pill-${index}`}
                  isTabStop={index === pillTabStop}
                  onArrow={(step) => movePillFocus(index, step)}
                />
              ))}
              {/* Space */}
              <div style={{ height: '6px', flexShrink: 0, width: '100%' }} />
            </>
          )}
        </div>
      </AccordionDetails>
    </Accordion>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export const CustomToolbox: React.FC<CustomToolboxProps> = ({
  collapsed,
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
  onBlockActivate,
  macroDetailsById,
}) => {
  const theme = useTheme()
  // Robot Actions (pick/place/gripper), not Task Flow (loops/conditionals) —
  // a brand-new task is more likely to start with a physical action than a
  // control-flow construct.
  const [expandedKey, setExpandedKey] = useState<string | null>('robot-actions')

  const handleAccordionChange = (key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key))
  }

  // H / Shift+H walk the categories, mirroring the heading-jump convention
  // Blockly documents. Blockly's own next_heading/previous_heading are inert in
  // this app — their precondition requires a native flyout, which this
  // integration never creates — so there is nothing to collide with, and the
  // shortcut has to be re-implemented here to mean anything.
  //
  // Scoped to the toolbox's own root rather than to `document`: containment
  // gives us "only fires when focus is in the palette" for free, so typing an
  // "h" in a search field elsewhere can never jump the palette.
  const handleToolboxKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'h' && e.key !== 'H') return
    // Never steal the letter from someone typing it.
    const active = document.activeElement
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable)
    ) {
      return
    }
    e.preventDefault()
    const step = e.shiftKey ? -1 : 1
    const count = TOOLBOX_CATEGORIES.length
    const current = TOOLBOX_CATEGORIES.findIndex((c) => c.key === expandedKey)
    // Nothing expanded: enter the list from the end the direction points at.
    const from = current === -1 ? (step === 1 ? -1 : 0) : current
    const next = TOOLBOX_CATEGORIES[(from + step + count) % count]
    // Expand what we land on. Selection follows focus here for the same reason
    // it does in the Objects/Locations/Skills tab strip below: if `expandedKey`
    // did not track where H just went, the next press would compute its index
    // from the stale category and appear to skip one.
    setExpandedKey(next.key)
    document.getElementById(`toolbox-category-${next.key}`)?.focus()
  }

  return (
    <aside
      onKeyDown={handleToolboxKeyDown}
      className={
        collapsed
          ? 'custom-toolbox custom-toolbox--collapsed'
          : 'custom-toolbox'
      }
      data-view-mode={blockViewMode}
      ref={onRootRefChange}
      // inert, not aria-hidden alone — same reasoning as DigitalTwinPanel's
      // simOpen gate: aria-hidden leaves a still-mounted panel's controls
      // reachable by Tab, inert removes them from the tab order too.
      inert={collapsed}
    >
      {/* Fixed at 240px regardless of the outer <aside>'s width — the outer
          box is what animates shut (clipped via its own overflow:hidden).
          Without this split, the content itself was forced to reflow at
          every intermediate width, wrapping and stacking its own text
          before disappearing instead of just sliding out of view clipped. */}
      <div className="custom-toolbox__inner">
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
                {isDeleting ? 'DELETE ZONE' : UI_TEXT.toolbox.toUpperCase()}
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
              {isDeleting
                ? 'Drop block to remove'
                : 'Drag blocks into workspace'}
            </span>
          </div>

          {onCollapse && !isDeleting && (
            <Tooltip title="Hide toolbox">
              <IconButton
                size="small"
                onClick={onCollapse}
                aria-label="Hide toolbox"
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
                onBlockActivate={onBlockActivate}
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
      </div>
    </aside>
  )
}
