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
import { PlayCircle, AlertCircle, ArrowLeft } from 'lucide-react'
import { useDispatch } from 'react-redux'

import { AbstractStep, AbstractCondition } from 'pages/tasks/types'
import { clearProposedTask } from 'store/reducers/proposal'
import { abstractToBlockly } from 'utils/blocklyParser'
import { Theme as ThemeOption } from 'themes/theme'

import { StepTree } from './StepTree'

// Tree-node icons are built in module-scope helpers (no hook access), so the
// step/condition colors are sourced once from the design-system tokens.
const tokenPalette = ThemeOption()
const STEP_ICON_COLOR = tokenPalette.primary.dark
const COND_ICON_COLOR = tokenPalette.warning.main

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

// Helper function to build tree nodes recursively with stable path keys
const buildTreeNodes = (
  steps: AbstractStep[],
  dataObjects: any[],
  dataLocations: any[],
  dataActions: any[],
  parentPath: string = 'step',
): any[] => {
  return steps.map((step, index) => {
    const { type } = step
    const currentPath = `${parentPath}-${type}-${index}`

    let title: React.ReactNode
    let icon: React.ReactNode | undefined
    let children: any[] = []

    switch (type) {
      case 'pick':
        title = `Pick: ${getNameFromId((step as any).objectId, dataObjects)}`
        icon = <PlayCircle size={16} style={{ color: STEP_ICON_COLOR }} />
        break
      case 'place':
        title = `Place: ${getNameFromId((step as any).locationId, dataLocations)}`
        icon = <PlayCircle size={16} style={{ color: STEP_ICON_COLOR }} />
        break
      case 'processing':
        // MAPPING REFERENCE:
        // - step type: 'processing' ➔ User-facing title prefix: 'Run' (renamed from 'Perform')
        title = `Run: ${getNameFromId((step as any).actionId, dataActions)}`
        icon = <PlayCircle size={16} style={{ color: STEP_ICON_COLOR }} />
        break
      case 'move_to':
        title = `Move To: ${getNameFromId((step as any).locationId, dataLocations)} (${(step as any).motionType})`
        icon = <PlayCircle size={16} style={{ color: STEP_ICON_COLOR }} />
        break
      case 'gripper':
        title = `Gripper: ${(step as any).state}`
        icon = <PlayCircle size={16} style={{ color: STEP_ICON_COLOR }} />
        break
      case 'wait':
        title = `Wait: ${(step as any).seconds}s`
        icon = <PlayCircle size={16} style={{ color: STEP_ICON_COLOR }} />
        break
      case 'human_action':
        title = `Human Action: ${(step as any).description || 'No description'}`
        icon = <PlayCircle size={16} style={{ color: STEP_ICON_COLOR }} />
        break
      case 'notify_action':
        title = `Notify: ${(step as any).description || 'No description'}`
        icon = <PlayCircle size={16} style={{ color: STEP_ICON_COLOR }} />
        break
      case 'repeat':
        title = `Repeat ${(step as any).times} times`
        icon = <PlayCircle size={16} style={{ color: STEP_ICON_COLOR }} />
        if ((step as any).steps && (step as any).steps.length > 0) {
          children = buildTreeNodes(
            (step as any).steps,
            dataObjects,
            dataLocations,
            dataActions,
            currentPath,
          )
        }
        break
      case 'repeat_until': {
        title = 'Repeat Until'
        icon = <PlayCircle size={16} style={{ color: STEP_ICON_COLOR }} />
        if ((step as any).condition) {
          const conditionNode = renderConditionNode(
            (step as any).condition,
            dataObjects,
            dataLocations,
            dataActions,
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
              currentPath,
            ),
          ]
        }
        break
      }
      case 'when':
        title = 'When'
        icon = <PlayCircle size={16} style={{ color: STEP_ICON_COLOR }} />
        // Build condition node
        if ((step as any).condition) {
          const conditionNode = renderConditionNode(
            (step as any).condition,
            dataObjects,
            dataLocations,
            dataActions,
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
              `${currentPath}-otherwise`,
            ),
          ]
        }
        break
      default:
        title = `Unknown step: ${type}`
        icon = <AlertCircle size={16} style={{ color: COND_ICON_COLOR }} />
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
  path: string,
): any => {
  const { type } = condition

  switch (type) {
    case 'sensor_signal':
      return {
        title: `Sensor: ${condition.sensor}`,
        icon: <AlertCircle size={16} style={{ color: COND_ICON_COLOR }} />,
        key: `${path}-sensor`,
      }
    case 'find_object':
      return {
        title: `Find Object: ${getNameFromId(condition.objectId, dataObjects)}`,
        icon: <AlertCircle size={16} style={{ color: COND_ICON_COLOR }} />,
        key: `${path}-find-object`,
      }
    case 'human_feedback':
      return {
        title: 'Human Feedback',
        icon: <AlertCircle size={16} style={{ color: COND_ICON_COLOR }} />,
        key: `${path}-human-feedback`,
      }
    case 'touch_detect':
      return {
        title: 'Touch Detect',
        icon: <AlertCircle size={16} style={{ color: COND_ICON_COLOR }} />,
        key: `${path}-touch`,
      }
    case 'gesture':
      return {
        title: `Gesture: ${condition.gestureType}`,
        icon: <AlertCircle size={16} style={{ color: COND_ICON_COLOR }} />,
        key: `${path}-gesture`,
      }
    case 'timer':
      return {
        title: `Timer: ${condition.seconds}s`,
        icon: <AlertCircle size={16} style={{ color: COND_ICON_COLOR }} />,
        key: `${path}-timer`,
      }
    case 'and':
      return {
        title: 'AND',
        icon: <AlertCircle size={16} style={{ color: COND_ICON_COLOR }} />,
        key: `${path}-and`,
        children: [
          renderConditionNode(
            condition.left,
            dataObjects,
            dataLocations,
            dataActions,
            `${path}-l`,
          ),
          renderConditionNode(
            condition.right,
            dataObjects,
            dataLocations,
            dataActions,
            `${path}-r`,
          ),
        ].filter((child): child is any => child !== null),
      }
    case 'or':
      return {
        title: 'OR',
        icon: <AlertCircle size={16} style={{ color: COND_ICON_COLOR }} />,
        key: `${path}-or`,
        children: [
          renderConditionNode(
            condition.left,
            dataObjects,
            dataLocations,
            dataActions,
            `${path}-l`,
          ),
          renderConditionNode(
            condition.right,
            dataObjects,
            dataLocations,
            dataActions,
            `${path}-r`,
          ),
        ].filter((child): child is any => child !== null),
      }
    case 'not':
      return {
        title: 'NOT',
        icon: <AlertCircle size={16} style={{ color: COND_ICON_COLOR }} />,
        key: `${path}-not`,
        children: [
          renderConditionNode(
            condition.condition,
            dataObjects,
            dataLocations,
            dataActions,
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

  const handleApply = () => {
    if (!proposedTask) {
      onCancel()
      return
    }

    try {
      // Convert the proposed task to Blockly XML
      const blocklyXml = abstractToBlockly(
        proposedTask,
        dataObjects,
        dataLocations,
        dataActions,
      )

      // Call the onApply callback (parent should handle updating the task structure)
      onApply()

      // Clear the proposal
      dispatch(clearProposedTask())
    } catch (error) {
      console.error('Error applying task:', error)
      // Optionally show an error message
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
        borderRadius: '10px',
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
          transform: translateY(-1px) scale(1.03);
          box-shadow: 0 4px 8px ${alpha(theme.palette.common.black, 0.05)} !important;
        }
        .task-btn-premium:active:not(:disabled) {
          transform: scale(0.95);
        }
        .task-btn-apply-premium:hover:not(:disabled) {
          transform: translateY(-1px) scale(1.03);
          box-shadow: 0 4px 10px ${alpha(theme.palette.primary.dark, 0.25)} !important;
          background: ${theme.palette.primary.darker} !important;
        }
        .task-btn-apply-premium:active:not(:disabled) {
          transform: scale(0.95);
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
              Validation Warnings
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
            )}
          />
        </div>

        {/* Action buttons */}
        <div
          style={{
            marginTop: 'auto',
            textAlign: 'right',
            paddingTop: '12px',
            borderTop: `1px solid ${alpha(theme.palette.primary.dark, 0.1)}`,
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
