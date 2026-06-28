import React, { useMemo } from 'react'
import { useTheme } from '@mui/material'
import { CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react'

import { analyzeAbstractTask, AnalyzerIssue } from 'utils/taskAnalyzer'
import { AbstractTask } from 'pages/tasks/types'

interface EvaluationCardProps {
  task: AbstractTask
}

/** Render a step path like [0, 'steps', 1] into something a beginner reads. */
const formatStepPath = (path: (number | string)[]): string => {
  const lastIndex = [...path].reverse().find((p) => typeof p === 'number')
  const nested = path.some(
    (p) => p === 'steps' || p === 'do' || p === 'otherwise',
  )
  const base = typeof lastIndex === 'number' ? `Step ${lastIndex + 1}` : 'Task'
  return nested ? `${base} · inside a loop or condition` : base
}

const IssueRow: React.FC<{ issue: AnalyzerIssue }> = ({ issue }) => {
  const theme = useTheme()
  const isError = issue.type === 'error'
  const accent = isError
    ? theme.palette.error.darker
    : theme.palette.warning.darker
  return (
    <li
      style={{
        display: 'flex',
        gap: '8px',
        alignItems: 'flex-start',
        listStyle: 'none',
        padding: '8px 0',
        borderTop: `1px solid ${theme.palette.divider}`,
      }}
    >
      {isError ? (
        <AlertCircle
          size={15}
          style={{ color: accent, flexShrink: 0, marginTop: 2 }}
        />
      ) : (
        <AlertTriangle
          size={15}
          style={{ color: accent, flexShrink: 0, marginTop: 2 }}
        />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            fontSize: 13,
            color: theme.palette.slate[900],
            lineHeight: 1.4,
          }}
        >
          {issue.message}
        </span>
        <span style={{ fontSize: 11, color: theme.palette.slate[500] }}>
          {formatStepPath(issue.stepPath)}
        </span>
      </div>
    </li>
  )
}

export const EvaluationCard: React.FC<EvaluationCardProps> = ({ task }) => {
  const theme = useTheme()
  const issues = useMemo(() => analyzeAbstractTask(task), [task])
  const errors = issues.filter((i) => i.type === 'error')
  const warnings = issues.filter((i) => i.type === 'warning')

  const ready = errors.length === 0 && warnings.length === 0
  const verdict = errors.length
    ? `${errors.length} ${errors.length === 1 ? 'thing' : 'things'} to fix before running`
    : warnings.length
      ? `${warnings.length} ${warnings.length === 1 ? 'thing' : 'things'} to review`
      : 'Ready to run'
  const accent = errors.length
    ? theme.palette.error.darker
    : warnings.length
      ? theme.palette.warning.darker
      : theme.palette.success.darker

  return (
    <div
      style={{
        margin: '4px 0 8px 0',
        maxWidth: '85%',
        alignSelf: 'flex-start',
        background: theme.palette.background.paper,
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: '14px',
        padding: '14px 16px',
        boxShadow: '0 2px 10px rgba(15, 23, 42, 0.05)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {ready ? (
          <CheckCircle2 size={18} style={{ color: accent }} />
        ) : errors.length ? (
          <AlertCircle size={18} style={{ color: accent }} />
        ) : (
          <AlertTriangle size={18} style={{ color: accent }} />
        )}
        <span style={{ fontSize: 14, fontWeight: 600, color: accent }}>
          {verdict}
        </span>
      </div>

      {ready ? (
        <p
          style={{
            margin: '8px 0 0',
            fontSize: 13,
            color: theme.palette.slate[600],
          }}
        >
          No problems found — you can start the simulation.
        </p>
      ) : (
        <>
          {errors.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: theme.palette.error.darker,
                }}
              >
                To fix
              </span>
              <ul style={{ margin: '4px 0 0', padding: 0 }}>
                {errors.map((issue, idx) => (
                  <IssueRow key={`e-${idx}`} issue={issue} />
                ))}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: theme.palette.warning.darker,
                }}
              >
                To review
              </span>
              <ul style={{ margin: '4px 0 0', padding: 0 }}>
                {warnings.map((issue, idx) => (
                  <IssueRow key={`w-${idx}`} issue={issue} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
