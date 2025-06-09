import React from 'react'
import { Modal } from 'antd'
import { AnalyzerIssue } from 'utils/taskAnalyzer'

interface AnalyzeTaskModalProps {
  analyzingTask: { name: string } | null
  analyzeModalVisible: boolean
  setAnalyzeModalVisible: (visible: boolean) => void
  analyzeResults: AnalyzerIssue[] | null
}

export const AnalyzeTaskModal = ({
  analyzingTask,
  analyzeModalVisible,
  setAnalyzeModalVisible,
  analyzeResults,
}: AnalyzeTaskModalProps) => {
  return (
    <Modal
      title={`Analysis results for: ${analyzingTask?.name}`}
      open={analyzeModalVisible}
      onCancel={() => setAnalyzeModalVisible(false)}
      footer={null}
    >
      {analyzeResults ? (
        analyzeResults.length === 0 ? (
          <p style={{ color: 'green' }}>No issues found. Task is valid!</p>
        ) : (
          <ul>
            {analyzeResults.map((issue, idx) => (
              <li
                key={idx}
                style={{ color: issue.type === 'error' ? 'red' : 'orange' }}
              >
                {issue.message} (at step {issue.stepPath.join(' > ')})
              </li>
            ))}
          </ul>
        )
      ) : (
        <p>Analyzing...</p>
      )}
    </Modal>
  )
}
