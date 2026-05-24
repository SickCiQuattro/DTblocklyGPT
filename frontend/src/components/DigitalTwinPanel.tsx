import React from 'react';
import { Card, Space, Divider, Typography } from 'antd';
import { PlayCircleOutlined, StopOutlined, LoadingOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { endpoints } from 'services/endpoints';
import { MethodHTTP, fetchApi } from 'services/api';
import {
  startSimulation as startSimAction,
  stopSimulation as stopSimAction,
  setSimulationCompleted,
  setSimulationError,
} from 'store/reducers/simulation';

interface DigitalTwinPanelProps {
  taskId: string;
  onClose: () => void;
}

export const DigitalTwinPanel: React.FC<DigitalTwinPanelProps> = ({ taskId, onClose }) => {
  const dispatch = useDispatch();
  const simulation = useSelector((state: any) => state.simulation);

  const startSimulation = async () => {
    if (!taskId) return;
    dispatch(startSimAction());
    try {
      await fetchApi({
        url: endpoints.task.simulate,
        method: MethodHTTP.POST,
        body: {
          id: Number(taskId),
          simulateEvent: true,
        },
      });
      dispatch(setSimulationCompleted());
    } catch (error: any) {
      console.error('Error starting simulation:', error);
      dispatch(setSimulationError(error?.message || 'Error starting simulation'));
    }
  };

  const stopSimulation = () => {
    dispatch(stopSimAction());
  };

  return (
    <Card
      bordered={false}
      style={{
        height: '100%',
        background: 'rgba(255, 255, 255, 0.15)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: '16px',
        boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37)',
      }}
    >
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <Typography.Title level={4} style={{ margin: 0, color: 'rgba(0, 0, 0, 0.85)' }}>
            Digital Twin / Simulation
          </Typography.Title>
          <div onClick={onClose} style={{ cursor: 'pointer', fontSize: '20px', color: '#8c8c8c' }}>
            <span>x</span>
          </div>
        </div>
        <Divider style={{ margin: '0 0 16px 0', opacity: 0.2 }} />

        <div style={{ marginBottom: '16px' }}>
          <Typography.Text strong style={{ marginRight: '8px' }}>Status:</Typography.Text>
          <Typography.Text>{simulation.message}</Typography.Text>
        </div>

        {simulation.isRunning && (
          <div style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <LoadingOutlined style={{ color: '#1890ff' }} spin />
              <Typography.Text strong>Execution Progress:</Typography.Text>
            </div>
            <div style={{ height: '8px', background: 'rgba(0, 0, 0, 0.05)', borderRadius: '4px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${simulation.progress}%`,
                  height: '100%',
                  background: '#1890ff',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <Typography.Text style={{ display: 'block', marginTop: '4px', textAlign: 'right' }}>
              {simulation.progress}%
            </Typography.Text>
          </div>
        )}

        {/* Premium Digital Twin Visualizer Mock Frame */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.03)',
            border: '1px dashed rgba(0, 0, 0, 0.1)',
            borderRadius: '12px',
            padding: '24px',
            textAlign: 'center',
            color: 'rgba(0, 0, 0, 0.45)',
          }}
        >
          <Space direction="vertical" align="center">
            <div style={{ fontSize: '32px', opacity: 0.7 }}>Robot</div>
            <Typography.Text style={{ fontSize: '14px' }}>
              WSL / Gazebo ROS2 Simulation Workspace Active
            </Typography.Text>
          </Space>
        </div>
      </div>

      <Divider style={{ margin: '16px 0', opacity: 0.2 }} />
      <div style={{ textAlign: 'center', paddingBottom: '8px' }}>
        <Space size="middle">
          <button
            onClick={startSimulation}
            disabled={simulation.isRunning}
            style={{
              padding: '8px 20px',
              background: simulation.isRunning ? 'rgba(0, 0, 0, 0.05)' : '#1890ff',
              color: simulation.isRunning ? 'rgba(0, 0, 0, 0.25)' : '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: simulation.isRunning ? 'not-allowed' : 'pointer',
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.3s',
            }}
          >
            <PlayCircleOutlined /> Start Simulation
          </button>
          <button
            onClick={stopSimulation}
            disabled={!simulation.isRunning}
            style={{
              padding: '8px 20px',
              background: '#ff4d4f',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: !simulation.isRunning ? 'not-allowed' : 'pointer',
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.3s',
              opacity: !simulation.isRunning ? 0.5 : 1,
            }}
          >
            <StopOutlined /> Stop
          </button>
        </Space>
      </div>
    </Card>
  );
};