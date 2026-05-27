import React from 'react';
import { Alert, Button, Space, Typography, Tree } from 'antd';
import {
  PlayCircle,
  AlertCircle,
} from 'lucide-react';
import { AbstractStep, AbstractCondition } from 'pages/tasks/types';
import { useDispatch } from 'react-redux';
import { clearProposedTask } from 'store/reducers/proposal';
import { abstractToBlockly } from 'utils/blocklyParser';

// Helper function to get the display name for an ID from the catalogs
const getNameFromId = (id: number | string | null, catalog: any[], nameField: string = 'name'): string => {
  if (id === null || id === undefined) return '';
  const item = catalog.find((item: any) => item.id === id);
  return item ? item[nameField] : `Unknown ID: ${id}`;
};

// Helper function to build tree nodes recursively with stable path keys
const buildTreeNodes = (
  steps: AbstractStep[],
  dataObjects: any[],
  dataLocations: any[],
  dataActions: any[],
  parentPath: string = 'step'
): any[] => {
  return steps.map((step, index) => {
    const { type } = step;
    const currentPath = `${parentPath}-${type}-${index}`;

    let title: React.ReactNode;
    let icon: React.ReactNode | undefined;
    let children: any[] = [];

    switch (type) {
      case 'pick':
        title = `Pick: ${getNameFromId((step as any).objectId, dataObjects)}`;
        icon = <PlayCircle size={16} style={{ color: '#4f46e5' }} />;
        break;
      case 'place':
        title = `Place: ${getNameFromId((step as any).locationId, dataLocations)}`;
        icon = <PlayCircle size={16} style={{ color: '#4f46e5' }} />;
        break;
      case 'processing':
        title = `Perform: ${getNameFromId((step as any).actionId, dataActions)}`;
        icon = <PlayCircle size={16} style={{ color: '#4f46e5' }} />;
        break;
      case 'move_to':
        title = `Move To: ${getNameFromId((step as any).locationId, dataLocations)} (${(step as any).motionType})`;
        icon = <PlayCircle size={16} style={{ color: '#4f46e5' }} />;
        break;
      case 'gripper':
        title = `Gripper: ${(step as any).state}`;
        icon = <PlayCircle size={16} style={{ color: '#4f46e5' }} />;
        break;
      case 'wait':
        title = `Wait: ${(step as any).seconds}s`;
        icon = <PlayCircle size={16} style={{ color: '#4f46e5' }} />;
        break;
      case 'human_action':
        title = `Human Action: ${(step as any).description || 'No description'}`;
        icon = <PlayCircle size={16} style={{ color: '#4f46e5' }} />;
        break;
      case 'notify_action':
        title = `Notify: ${(step as any).description || 'No description'}`;
        icon = <PlayCircle size={16} style={{ color: '#4f46e5' }} />;
        break;
      case 'repeat':
        title = `Repeat ${(step as any).times} times`;
        icon = <PlayCircle size={16} style={{ color: '#4f46e5' }} />;
        if ((step as any).steps && (step as any).steps.length > 0) {
          children = buildTreeNodes((step as any).steps, dataObjects, dataLocations, dataActions, currentPath);
        }
        break;
      case 'repeat_until':
        title = 'Repeat Until';
        icon = <PlayCircle size={16} style={{ color: '#4f46e5' }} />;
        if ((step as any).condition) {
          const conditionNode = renderConditionNode((step as any).condition, dataObjects, dataLocations, dataActions, `${currentPath}-cond`);
          if (conditionNode) {
            children.push(conditionNode);
          }
        }
        const repeatUntilSteps = (step as any).do || (step as any).steps;
        if (repeatUntilSteps && repeatUntilSteps.length > 0) {
          children = [...children, ...buildTreeNodes(repeatUntilSteps, dataObjects, dataLocations, dataActions, currentPath)];
        }
        break;
      case 'when':
        title = 'When';
        icon = <PlayCircle size={16} style={{ color: '#4f46e5' }} />;
        // Build condition node
        if ((step as any).condition) {
          const conditionNode = renderConditionNode((step as any).condition, dataObjects, dataLocations, dataActions, `${currentPath}-cond`);
          if (conditionNode) {
            children.push(conditionNode);
          }
        }
        // Build do steps
        if ((step as any).do && (step as any).do.length > 0) {
          children = [...children, ...buildTreeNodes((step as any).do, dataObjects, dataLocations, dataActions, `${currentPath}-do`)];
        }
        // Build otherwise steps
        if ((step as any).otherwise && (step as any).otherwise.length > 0) {
          children = [...children, ...buildTreeNodes((step as any).otherwise, dataObjects, dataLocations, dataActions, `${currentPath}-otherwise`)];
        }
        break;
      default:
        title = `Unknown step: ${type}`;
        icon = <AlertCircle size={16} style={{ color: '#f59e0b' }} />;
    }

    return {
      title,
      icon,
      key: currentPath,
      children: children.length > 0 ? children : undefined,
    };
  });
};

// Helper function to render a condition as a tree node with stable path keys
const renderConditionNode = (
  condition: AbstractCondition,
  dataObjects: any[],
  dataLocations: any[],
  dataActions: any[],
  path: string
): any | null => {
  const { type } = condition;

  switch (type) {
    case 'sensor_signal':
      return {
        title: `Sensor: ${condition.sensor}`,
        icon: <AlertCircle size={16} style={{ color: '#f59e0b' }} />,
        key: `${path}-sensor`,
      };
    case 'find_object':
      return {
        title: `Find Object: ${getNameFromId(condition.objectId, dataObjects)}`,
        icon: <AlertCircle size={16} style={{ color: '#f59e0b' }} />,
        key: `${path}-find-object`,
      };
    case 'human_feedback':
      return {
        title: 'Human Feedback',
        icon: <AlertCircle size={16} style={{ color: '#f59e0b' }} />,
        key: `${path}-human-feedback`,
      };
    case 'touch_detect':
      return {
        title: 'Touch Detect',
        icon: <AlertCircle size={16} style={{ color: '#f59e0b' }} />,
        key: `${path}-touch`,
      };
    case 'gesture':
      return {
        title: `Gesture: ${condition.gestureType}`,
        icon: <AlertCircle size={16} style={{ color: '#f59e0b' }} />,
        key: `${path}-gesture`,
      };
    case 'timer':
      return {
        title: `Timer: ${condition.seconds}s`,
        icon: <AlertCircle size={16} style={{ color: '#f59e0b' }} />,
        key: `${path}-timer`,
      };
    case 'and':
      return {
        title: 'AND',
        icon: <AlertCircle size={16} style={{ color: '#f59e0b' }} />,
        key: `${path}-and`,
        children: [
          renderConditionNode(condition.left, dataObjects, dataLocations, dataActions, `${path}-l`),
          renderConditionNode(condition.right, dataObjects, dataLocations, dataActions, `${path}-r`),
        ].filter((child): child is any => child !== null),
      };
    case 'or':
      return {
        title: 'OR',
        icon: <AlertCircle size={16} style={{ color: '#f59e0b' }} />,
        key: `${path}-or`,
        children: [
          renderConditionNode(condition.left, dataObjects, dataLocations, dataActions, `${path}-l`),
          renderConditionNode(condition.right, dataObjects, dataLocations, dataActions, `${path}-r`),
        ].filter((child): child is any => child !== null),
      };
    case 'not':
      return {
        title: 'NOT',
        icon: <AlertCircle size={16} style={{ color: '#f59e0b' }} />,
        key: `${path}-not`,
        children: [
          renderConditionNode(condition.condition, dataObjects, dataLocations, dataActions, `${path}-inner`),
        ].filter((child): child is any => child !== null),
      };
    default:
      return null;
  }
};

interface TaskPreviewCardProps {
  proposedTask: AbstractStep[] | null;
  validationWarnings: string[];
  answer: string;
  dataObjects: any[];
  dataLocations: any[];
  dataActions: any[];
  onApply: () => void;
  onCancel: () => void;
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
}) => {
  const dispatch = useDispatch();

  const handleApply = () => {
    if (!proposedTask) {
      onCancel();
      return;
    }

    try {
      // Convert the proposed task to Blockly XML
      const blocklyXml = abstractToBlockly(proposedTask, dataObjects, dataLocations, dataActions);

      // Call the onApply callback (parent should handle updating the task structure)
      onApply();

      // Clear the proposal
      dispatch(clearProposedTask());
    } catch (error) {
      console.error('Error applying task:', error);
      // Optionally show an error message
    }
  };

  const handleCancel = () => {
    onCancel();
    dispatch(clearProposedTask());
  };

  if (!proposedTask || proposedTask.length === 0) {
    return null; // Don't show the card if there's no proposed task
  }

  return (
    <div style={{
      background: 'rgba(79, 70, 229, 0.04)',
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(79, 70, 229, 0.15)',
      borderRadius: '16px',
      boxShadow: '0 8px 24px rgba(79, 70, 229, 0.08)',
      margin: '16px',
    }}>
      <div style={{ padding: '16px' }}>
        {/* Answer from the assistant */}
        {answer && (
          <div style={{ maxHeight: '120px', overflowY: 'auto', marginBottom: '12px', paddingRight: '4px' }}>
            <Typography.Text
              style={{ fontWeight: 600, color: '#1e1b4b', display: 'block', fontSize: '14px', lineHeight: '1.5' }}
            >
              {answer}
            </Typography.Text>
          </div>
        )}

        {/* Validation warnings */}
        {validationWarnings.length > 0 && (
          <Alert
            type="warning"
            message="Validation Warnings"
            description={
              <Space direction="vertical" style={{ marginTop: 4 }}>
                {validationWarnings.map((warning, index) => (
                  <Typography.Text
                    key={index}
                    type="secondary"
                    style={{ fontSize: '13px', color: '#b45309' }}
                  >
                    • {warning}
                  </Typography.Text>
                ))}
              </Space>
            }
            showIcon
            style={{ marginBottom: '16px', borderRadius: '12px' }}
          />
        )}

        {/* Task preview tree */}
        <Typography.Text
          style={{ fontWeight: 600, marginBottom: '8px', color: '#1e1b4b', display: 'block', fontSize: '14px' }}
        >
          Proposed Task Steps
        </Typography.Text>
        <Tree
          showLine
          defaultExpandAll
          style={{ maxHeight: '200px', overflowY: 'auto', background: 'transparent', padding: '8px 4px', borderRadius: '8px', marginBottom: '8px' }}
          treeData={buildTreeNodes(proposedTask, dataObjects, dataLocations, dataActions)}
        />

        {/* Action buttons */}
        <div style={{
          marginTop: '16px',
          textAlign: 'right',
          position: 'sticky',
          bottom: 0,
          background: 'rgba(251, 251, 254, 0.95)',
          backdropFilter: 'blur(8px)',
          paddingTop: '12px',
          borderTop: '1px solid rgba(79, 70, 229, 0.1)',
          zIndex: 10,
        }}>
          <Space size={8}>
            <Button
              type="default"
              size="middle"
              onClick={handleCancel}
              style={{
                width: 80,
                borderRadius: '8px',
                border: '1px solid rgba(0, 0, 0, 0.08)',
                color: '#4b5563',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              Cancel
            </Button>
            <Button
              type="primary"
              size="middle"
              onClick={handleApply}
              style={{
                width: 80,
                borderRadius: '8px',
                background: '#4f46e5',
                border: 'none',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              Apply
            </Button>
          </Space>
        </div>
      </div>
    </div>
  );
};