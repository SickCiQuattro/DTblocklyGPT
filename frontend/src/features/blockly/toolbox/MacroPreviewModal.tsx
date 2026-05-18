/**
 * MacroPreviewModal.tsx
 *
 * Full-screen modal for previewing the block structure of a saved macro task.
 * Renders a read-only Blockly workspace inside an MUI Dialog so the user can
 * inspect what a macro task block will expand to before using it.
 *
 * Used by `BlockPreviewTooltip` when the hovered toolbox item is a macro task
 * that has a serialised `macroCode` payload.
 */

import { Dialog, DialogTitle, IconButton, Typography } from '@mui/material'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { X } from 'lucide-react'

import { abstractToBlockly } from 'utils/blocklyParser'
import { BlockState as State } from 'utils/blocklyTypes'
import { type AbstractStep } from 'pages/tasks/types'

import { BlocklyViewerWithControls } from '../workspace'
import { isValidBlockState, parseJson } from '../utils/serialization'

// ─── TYPE GUARDS ─────────────────────────────────────────────────────────────
// Narrow unknown JSON payloads to the shapes we know how to convert.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const ABSTRACT_STEP_TYPES = new Set([
  'pick',
  'place',
  'processing',
  'move_to',
  'move_relative',
  'gripper',
  'repeat',
  'when',
  'human_action',
  'wait_for_human',
])

const isAbstractStepLike = (value: unknown): value is AbstractStep =>
  isRecord(value) &&
  typeof (value as { type?: unknown }).type === 'string' &&
  ABSTRACT_STEP_TYPES.has((value as { type: string }).type)

const isAbstractStepArray = (value: unknown): value is AbstractStep[] =>
  Array.isArray(value) && value.length > 0 && value.every(isAbstractStepLike)

const hasAbstractStepsArray = (
  value: unknown,
): value is { steps: AbstractStep[] } =>
  isRecord(value) && isAbstractStepArray((value as { steps?: unknown }).steps)

const hasWorkspaceBlocksPayload = (
  value: unknown,
): value is { blocks: { blocks: unknown[] } } =>
  isRecord(value) &&
  isRecord(value.blocks) &&
  Array.isArray((value.blocks as { blocks?: unknown }).blocks)

const hasTopLevelBlocksArray = (
  value: unknown,
): value is { blocks: unknown[] } =>
  isRecord(value) && Array.isArray((value as { blocks?: unknown }).blocks)

// ─── MACRO CODE PARSER ───────────────────────────────────────────────────────

/**
 * Parse a serialised macro code string into a Blockly block state tree that
 * `BlocklyViewer` can render. Supports multiple serialisation formats:
 *
 * - Raw `AbstractStep[]` array (from the abstract task format)
 * - `{ steps: AbstractStep[] }` wrapper object
 * - A direct Blockly `BlockState` object
 * - `{ blocks: { blocks: BlockState[] } }` workspace payload
 * - `{ blocks: BlockState[] }` top-level array wrapper
 *
 * @param macroCode Serialised task code string stored in `TaskType.code`.
 * @returns         A `BlockState` ready for `BlocklyViewer`, or `null` on failure.
 */
export const toMacroRootState = (macroCode: string): State | State[] | null => {
  try {
    const parsed = parseJson<unknown>(macroCode)
    if (!parsed) return null

    if (isValidBlockState(parsed)) {
      return parsed
    }

    if (isAbstractStepArray(parsed) || hasAbstractStepsArray(parsed)) {
      const steps = isAbstractStepArray(parsed) ? parsed : parsed.steps
      const converted = abstractToBlockly(steps, [], [], [])
      return isValidBlockState(converted) ? converted : null
    }

    if (hasWorkspaceBlocksPayload(parsed)) {
      const blocks = parsed.blocks.blocks
      if (blocks.length > 0 && isValidBlockState(blocks[0])) {
        return blocks[0]
      }
    }

    if (hasTopLevelBlocksArray(parsed) && parsed.blocks.length > 0) {
      const blocks = parsed.blocks as State[]
      return isValidBlockState(blocks) ? blocks : null
    }
  } catch (e) {
    console.error('Failed to parse macro code for preview:', e)
  }
  return null
}

// ─── MODAL COMPONENT ─────────────────────────────────────────────────────────

interface MacroPreviewModalProps {
  /** Whether the dialog is currently open. */
  isOpen: boolean
  /** Callback fired when the dialog should close. */
  onClose: () => void
  /** Human-readable macro name shown in the dialog header. */
  macroName: string
  /** Optional description shown below the name. */
  macroDescription?: string
  /** Raw serialised macro code string used to build the block preview. */
  macroCode: string
}

/**
 * Modal dialog that renders a full read-only Blockly workspace for a macro task.
 * The `macroCode` is parsed by `toMacroRootState` and fed to `BlocklyViewerWithControls`.
 */
export const MacroPreviewModal = ({
  isOpen,
  onClose,
  macroName,
  macroDescription,
  macroCode,
}: MacroPreviewModalProps) => {
  const macroState = toMacroRootState(macroCode)
  const resolvedMacroDescription =
    typeof macroDescription === 'string' && macroDescription.trim().length > 0
      ? macroDescription.trim()
      : 'No description available for this routine.'

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="macro-preview-dialog-title"
      slotProps={{
        paper: {
          sx: {
            overflow: 'hidden',
            borderRadius: 2,
            border: '1px solid #E2E8F0',
            boxShadow:
              '0 20px 50px rgba(15, 23, 42, 0.2), 0 6px 16px rgba(15, 23, 42, 0.12)',
          },
        },
      }}
    >
      <DialogTitle
        id="macro-preview-dialog-title"
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: '1px solid #E2E8F0',
          background:
            'linear-gradient(180deg, #FFFFFF 0%, rgba(248, 250, 252, 0.92) 100%)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            width: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              minWidth: 0,
            }}
          >
            <Typography
              component="h2"
              sx={{
                m: 0,
                fontSize: '1.08rem',
                fontWeight: 800,
                lineHeight: 1.2,
                color: '#0F172A',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              Saved Routine: {macroName}
            </Typography>
            <Typography
              component="p"
              sx={{
                m: 0,
                fontSize: '0.78rem',
                fontWeight: 500,
                lineHeight: 1.4,
                color: '#475569',
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 2,
                overflow: 'hidden',
              }}
            >
              {resolvedMacroDescription}
            </Typography>
          </div>
          <IconButton
            aria-label="Close"
            onClick={onClose}
            size="small"
            className="workspace-control-button"
          >
            <X size={18} />
          </IconButton>
        </div>
      </DialogTitle>
      <div
        style={{
          width: '100%',
          height: '450px',
          backgroundColor: '#F8FAFC',
          padding: 0,
          overflow: 'hidden',
        }}
      >
        <BlocklyViewerWithControls
          blockState={macroState}
          height="450px"
          startScale={1.2}
          autoCenter
          autoFit
        />
      </div>
    </Dialog>
  )
}
