import React from 'react'
import {
  Box,
  Button,
  Typography,
  Alert,
  AlertTitle,
  Stack,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Zap,
  User,
  Repeat2,
  Split,
  ScanEye,
  Mic,
  Clock,
} from 'lucide-react'
import { useDispatch } from 'react-redux'
import { toast } from 'react-toastify'

import { AbstractStep, AbstractCondition } from 'pages/tasks/types'
import { clearProposedTask } from 'store/reducers/proposal'
import { abstractToBlockly } from 'utils/blocklyParser'
import {
  RECOGNIZED_GESTURES,
  RECOGNIZED_VOICE_COMMANDS,
} from 'constants/recognitionRegistry'
import { blockMetaByType } from 'features/blockly/toolbox/toolboxRegistry'

import { StepTree } from './StepTree'

// Helper function to get the display name for an ID from the catalogs
const getNameFromId = (
  id: number | string | null,
  catalog: any[],
  nameField: string = 'name',
): string => {
  if (id === null || id === undefined) return ''
  const item = catalog.find((item: any) => item.id === id)
  return item ? item[nameField] : `Unknown ID: ${id}`
}

// Friendly label for a gesture/voice code (falls back to the raw code for
// values no longer in the registry, e.g. a legacy saved gesture).
const codeLabel = (
  options: { label: string; code: string }[],
  code: string,
): string => options.find((o) => o.code === code)?.label ?? code

// Same icon-per-block-type language already on the canvas (blocks/icons.ts,
// blocks/definitions.ts iconConfig calls) — pure reuse, not a new choice, so
// the preview reinforces the same visual vocabulary the operator already
// builds with instead of a uniform generic glyph for every step.
const STEP_ICON_BY_BLOCK_TYPE: Record<
  string,
  React.ComponentType<{ size?: number; style?: React.CSSProperties }>
> = {
  pick_block: Bot,
  place_block: Bot,
  move_to_block: Bot,
  gripper_block: Bot,
  open_gripper_block: Bot,
  close_gripper_block: Bot,
  wait_block: Bot,
  processing_block: Zap,
  human_action_block: User,
  notify_action_block: User,
  repeat_block: Repeat2,
  repeat_until_block: Repeat2,
  when_block: Split,
  when_otherwise_block: Split,
}

interface TreeColors {
  step: string
  cond: string
}

// Helper function to build tree nodes recursively with stable path keys
const buildTreeNodes = (
  steps: AbstractStep[],
  dataObjects: any[],
  dataLocations: any[],
  dataActions: any[],
  colors: TreeColors,
  parentPath: string = 'step',
): any[] => {
  return steps.map((step, index) => {
    const { type } = step
    const currentPath = `${parentPath}-${type}-${index}`

    let title: React.ReactNode
    let icon: React.ReactNode | undefined
    let children: any[] = []

    // Canonical label/colour of the block this step renders as, sourced from
    // the toolbox registry — falls back to a neutral step colour for any
    // type the registry doesn't know (shouldn't happen for valid steps). The
    // glyph itself mirrors the same per-block-type icon already used on the
    // canvas (STEP_ICON_BY_BLOCK_TYPE above).
    const stepIcon = (blockType: string) => {
      const Icon = STEP_ICON_BY_BLOCK_TYPE[blockType] ?? Bot
      return (
        <Icon
          size={16}
          style={{ color: blockMetaByType[blockType]?.colour ?? colors.step }}
        />
      )
    }

    switch (type) {
      case 'pick':
        title = `${blockMetaByType.pick_block.label}: ${getNameFromId((step as any).objectId, dataObjects)}`
        icon = stepIcon('pick_block')
        break
      case 'place':
        title = `${blockMetaByType.place_block.label}: ${getNameFromId((step as any).locationId, dataLocations)}`
        icon = stepIcon('place_block')
        break
      case 'processing':
        title = `${blockMetaByType.processing_block.label}: ${getNameFromId((step as any).actionId, dataActions)}`
        icon = stepIcon('processing_block')
        break
      case 'move_to':
        title = `${blockMetaByType.move_to_block.label}: ${getNameFromId((step as any).locationId, dataLocations)} (${(step as any).motionType})`
        icon = stepIcon('move_to_block')
        break
      case 'gripper': {
        const gripperBlockType =
          (step as any).state === 'OPEN'
            ? 'open_gripper_block'
            : 'close_gripper_block'
        title = blockMetaByType[gripperBlockType].label
        icon = stepIcon(gripperBlockType)
        break
      }
      case 'wait':
        title = `${blockMetaByType.wait_block.label}: ${(step as any).seconds}s`
        icon = stepIcon('wait_block')
        break
      case 'human_action': {
        title = `${blockMetaByType.human_action_block.label}: ${(step as any).description || 'No description'}`
        icon = stepIcon('human_action_block')
        // human_feedback/null both mean "just wait for a manual confirm" —
        // nothing sensor-based to show. Any real condition (find_object,
        // gesture, voice, timer, and/or/not) is shown exactly like when/
        // repeat_until do for their own condition, so the operator can see
        // what this step actually waits on before applying — the canvas
        // block already shows it as "Resume when: …", the preview shouldn't
        // hide it.
        const confirmEvent = (step as any).confirmEvent
        if (confirmEvent && confirmEvent.type !== 'human_feedback') {
          const conditionNode = renderConditionNode(
            confirmEvent,
            dataObjects,
            dataLocations,
            dataActions,
            colors,
            `${currentPath}-cond`,
          )
          if (conditionNode) {
            children.push(conditionNode)
          }
        }
        break
      }
      case 'notify_action':
        title = `${blockMetaByType.notify_action_block.label}: ${(step as any).description || 'No description'}`
        icon = stepIcon('notify_action_block')
        break
      case 'repeat':
        title = `Repeat ${(step as any).times} times`
        icon = stepIcon('repeat_block')
        if ((step as any).steps && (step as any).steps.length > 0) {
          children = buildTreeNodes(
            (step as any).steps,
            dataObjects,
            dataLocations,
            dataActions,
            colors,
            currentPath,
          )
        }
        break
      case 'repeat_until': {
        title = blockMetaByType.repeat_until_block.label
        icon = stepIcon('repeat_until_block')
        if ((step as any).condition) {
          const conditionNode = renderConditionNode(
            (step as any).condition,
            dataObjects,
            dataLocations,
            dataActions,
            colors,
            `${currentPath}-cond`,
          )
          if (conditionNode) {
            children.push(conditionNode)
          }
        }
        const repeatUntilSteps = (step as any).do || (step as any).steps
        if (repeatUntilSteps && repeatUntilSteps.length > 0) {
          children = [
            ...children,
            ...buildTreeNodes(
              repeatUntilSteps,
              dataObjects,
              dataLocations,
              dataActions,
              colors,
              currentPath,
            ),
          ]
        }
        break
      }
      case 'when': {
        const hasOtherwise =
          (step as any).otherwise && (step as any).otherwise.length > 0
        title = hasOtherwise
          ? blockMetaByType.when_otherwise_block.label
          : blockMetaByType.when_block.label
        icon = stepIcon(hasOtherwise ? 'when_otherwise_block' : 'when_block')
        // Build condition node
        if ((step as any).condition) {
          const conditionNode = renderConditionNode(
            (step as any).condition,
            dataObjects,
            dataLocations,
            dataActions,
            colors,
            `${currentPath}-cond`,
          )
          if (conditionNode) {
            children.push(conditionNode)
          }
        }
        // Build do steps
        if ((step as any).do && (step as any).do.length > 0) {
          children = [
            ...children,
            ...buildTreeNodes(
              (step as any).do,
              dataObjects,
              dataLocations,
              dataActions,
              colors,
              `${currentPath}-do`,
            ),
          ]
        }
        // Build otherwise steps
        if ((step as any).otherwise && (step as any).otherwise.length > 0) {
          children = [
            ...children,
            ...buildTreeNodes(
              (step as any).otherwise,
              dataObjects,
              dataLocations,
              dataActions,
              colors,
              `${currentPath}-otherwise`,
            ),
          ]
        }
        break
      }
      default:
        title = `Unknown step: ${type}`
        icon = <AlertCircle size={16} style={{ color: colors.cond }} />
    }

    return {
      title,
      icon,
      key: currentPath,
      children: children.length > 0 ? children : undefined,
    }
  })
}

// Helper function to render a condition as a tree node with stable path keys
const renderConditionNode = (
  condition: AbstractCondition,
  dataObjects: any[],
  dataLocations: any[],
  dataActions: any[],
  colors: TreeColors,
  path: string,
): any => {
  const { type } = condition

  switch (type) {
    case 'sensor_signal':
      return {
        title: `Sensor: ${condition.sensor}`,
        icon: <AlertCircle size={16} style={{ color: colors.cond }} />,
        key: `${path}-sensor`,
      }
    case 'find_object':
      return {
        title: `${blockMetaByType.find_object_block.label}: ${getNameFromId(condition.objectId, dataObjects)}`,
        icon: <ScanEye size={16} style={{ color: colors.cond }} />,
        key: `${path}-find-object`,
      }
    case 'human_feedback':
      return {
        title: 'Wait for confirmation',
        icon: <AlertCircle size={16} style={{ color: colors.cond }} />,
        key: `${path}-human-feedback`,
      }
    case 'touch_detect':
      return {
        title: 'Touch Detect',
        icon: <AlertCircle size={16} style={{ color: colors.cond }} />,
        key: `${path}-touch`,
      }
    case 'gesture':
      return {
        title: `${blockMetaByType.gesture_block.label}: ${codeLabel(RECOGNIZED_GESTURES, condition.gestureType)}`,
        icon: <ScanEye size={16} style={{ color: colors.cond }} />,
        key: `${path}-gesture`,
      }
    case 'voice':
      return {
        title: `${blockMetaByType.voice_command_block.label}: ${codeLabel(RECOGNIZED_VOICE_COMMANDS, condition.voiceWord)}`,
        icon: <Mic size={16} style={{ color: colors.cond }} />,
        key: `${path}-voice`,
      }
    case 'timer':
      return {
        title: `Time passed: ${condition.seconds}s`,
        icon: <Clock size={16} style={{ color: colors.cond }} />,
        key: `${path}-timer`,
      }
    case 'and':
      return {
        title: 'AND',
        icon: <AlertCircle size={16} style={{ color: colors.cond }} />,
        key: `${path}-and`,
        children: [
          renderConditionNode(
            condition.left,
            dataObjects,
            dataLocations,
            dataActions,
            colors,
            `${path}-l`,
          ),
          renderConditionNode(
            condition.right,
            dataObjects,
            dataLocations,
            dataActions,
            colors,
            `${path}-r`,
          ),
        ].filter((child): child is any => child !== null),
      }
    case 'or':
      return {
        title: 'OR',
        icon: <AlertCircle size={16} style={{ color: colors.cond }} />,
        key: `${path}-or`,
        children: [
          renderConditionNode(
            condition.left,
            dataObjects,
            dataLocations,
            dataActions,
            colors,
            `${path}-l`,
          ),
          renderConditionNode(
            condition.right,
            dataObjects,
            dataLocations,
            dataActions,
            colors,
            `${path}-r`,
          ),
        ].filter((child): child is any => child !== null),
      }
    case 'not':
      return {
        title: 'NOT',
        icon: <AlertCircle size={16} style={{ color: colors.cond }} />,
        key: `${path}-not`,
        children: [
          renderConditionNode(
            condition.condition,
            dataObjects,
            dataLocations,
            dataActions,
            colors,
            `${path}-inner`,
          ),
        ].filter((child): child is any => child !== null),
      }
    default:
      return null
  }
}

interface TaskPreviewCardProps {
  proposedTask: AbstractStep[] | null
  validationWarnings: string[]
  answer: string
  dataObjects: any[]
  dataLocations: any[]
  dataActions: any[]
  onApply: () => void
  onCancel: () => void
  onBack?: () => void
}

export const TaskPreviewCard: React.FC<TaskPreviewCardProps> = ({
  proposedTask,
  validationWarnings,
  answer,
  dataObjects,
  dataLocations,
  dataActions,
  onApply,
  onCancel,
  onBack,
}) => {
  const theme = useTheme()
  const dispatch = useDispatch()
  const treeColors: TreeColors = {
    step: theme.palette.primary.dark,
    // Neutral/info, not warning.main — a condition node isn't an alert,
    // that hue is reserved for the real validation-warning Alert below.
    cond: theme.palette.info.main,
  }

  const handleApply = () => {
    if (!proposedTask) {
      onCancel()
      return
    }

    try {
      // Validate the proposed task converts cleanly before touching the
      // workspace — onApply() takes no payload, the parent re-derives the
      // blocks itself; this call exists purely as a pre-flight check.
      abstractToBlockly(proposedTask, dataObjects, dataLocations, dataActions)

      // Call the onApply callback (parent should handle updating the task structure)
      onApply()

      // Clear the proposal
      dispatch(clearProposedTask())
    } catch (error) {
      console.error('Error applying task:', error)
      toast.error(
        "Couldn't add these blocks to the workspace — the proposal wasn't applied.",
      )
    }
  }

  const handleCancel = () => {
    onCancel()
    dispatch(clearProposedTask())
  }

  if (!proposedTask || proposedTask.length === 0) {
    return null // Don't show the card if there's no proposed task
  }

  return (
    <div
      className="task-card-premium"
      style={{
        background: theme.palette.background.paper,
        borderRadius: '12px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: 'none',
      }}
    >
      <style>{`
        @keyframes task-card-entrance {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: no-preference) {
          .task-card-premium {
            animation: task-card-entrance 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
          }
        }
        .task-card-tree::-webkit-scrollbar {
          width: 4px !important;
        }
        .task-card-tree::-webkit-scrollbar-track {
          background: ${alpha(theme.palette.common.black, 0.02)} !important;
          border-radius: 10px !important;
        }
        .task-card-tree::-webkit-scrollbar-thumb {
          background: ${alpha(theme.palette.primary.dark, 0.25)} !important;
          border-radius: 10px !important;
        }
        .task-card-tree::-webkit-scrollbar-thumb:hover {
          background: ${alpha(theme.palette.primary.dark, 0.45)} !important;
        }
        @media (prefers-reduced-motion: no-preference) {
          .task-btn-premium {
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
          }
          .task-btn-apply-premium {
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
          }
        }
        .task-btn-premium:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 8px ${alpha(theme.palette.common.black, 0.05)} !important;
        }
        .task-btn-apply-premium:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 10px ${alpha(theme.palette.primary.dark, 0.25)} !important;
          background: ${theme.palette.primary.darker} !important;
        }
      `}</style>
      <div
        style={{
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        {/* Back Button Header */}
        {onBack && (
          <div style={{ marginBottom: '12px', flexShrink: 0 }}>
            <button
              onClick={onBack}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: theme.palette.primary.dark,
                fontWeight: 600,
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 0',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.transform = 'translateX(-2px)')
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.transform = 'translateX(0)')
              }
            >
              <ArrowLeft size={14} /> Back to Chat
            </button>
          </div>
        )}

        {/* Answer from the assistant */}
        {answer && (
          <div
            style={{
              maxHeight: '90px',
              overflowY: 'auto',
              marginBottom: '12px',
              paddingRight: '4px',
              flexShrink: 0,
            }}
          >
            <Typography
              style={{
                fontWeight: 600,
                color: theme.palette.primary.darker,
                display: 'block',
                fontSize: '14px',
                lineHeight: '1.5',
              }}
            >
              {answer}
            </Typography>
          </div>
        )}

        {/* Validation warnings */}
        {validationWarnings.length > 0 && (
          <Alert
            severity="warning"
            sx={{ marginBottom: '12px', borderRadius: '12px', flexShrink: 0 }}
          >
            <AlertTitle sx={{ fontWeight: 600, fontSize: '14px', m: 0 }}>
              Check these before running
            </AlertTitle>
            <Box sx={{ maxHeight: '80px', overflowY: 'auto', mt: 0.5 }}>
              <Stack spacing={0.5}>
                {validationWarnings.map((warning, index) => (
                  <Typography
                    key={index}
                    variant="caption"
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      color: theme.palette.warning.darker,
                    }}
                  >
                    • {warning}
                  </Typography>
                ))}
              </Stack>
            </Box>
          </Alert>
        )}

        {/* Task preview tree */}
        <Typography
          style={{
            fontWeight: 600,
            marginBottom: '6px',
            color: theme.palette.primary.darker,
            display: 'block',
            fontSize: '14px',
            flexShrink: 0,
          }}
        >
          Proposed Task Steps
        </Typography>
        <div
          className="task-card-tree"
          style={{
            flex: 1,
            overflowY: 'auto',
            minHeight: 0,
            marginBottom: '8px',
            background: 'transparent',
            padding: '4px 8px',
            borderRadius: '12px',
            border: `1px solid ${theme.palette.divider}`,
          }}
        >
          <StepTree
            treeData={buildTreeNodes(
              proposedTask,
              dataObjects,
              dataLocations,
              dataActions,
              treeColors,
            )}
          />
        </div>

        {/* Action buttons */}
        <div
          style={{
            marginTop: 'auto',
            textAlign: 'right',
            paddingTop: '12px',
            borderTop: `1px solid ${theme.palette.divider}`,
            zIndex: 10,
            flexShrink: 0,
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{ justifyContent: 'flex-end' }}
          >
            <Button
              variant="outlined"
              size="medium"
              onClick={handleCancel}
              className="task-btn-premium"
              style={{
                minWidth: 80,
                borderRadius: '8px',
                borderColor: theme.palette.divider,
                color: theme.palette.slate[600],
                fontSize: '13px',
                fontWeight: 500,
                textTransform: 'none',
              }}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              color="primary"
              size="medium"
              onClick={handleApply}
              className="task-btn-apply-premium"
              style={{
                minWidth: 80,
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                textTransform: 'none',
              }}
            >
              Apply
            </Button>
          </Stack>
        </div>
      </div>
    </div>
  )
}
