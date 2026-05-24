import React from 'react'
import { Collapse, Divider } from 'antd'
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'
import { useDispatch, useSelector } from 'react-redux'
import { toast } from 'react-toastify'
import { useParams } from 'react-router-dom'
import * as Blockly from 'blockly/core'
import {
  CopyOutlined,
  EditOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  SyncOutlined,
} from '@ant-design/icons'

import { MethodHTTP, fetchApi } from 'services/api'
import { endpoints } from 'services/endpoints'
import { getBlocklyStructure } from 'features/blockly'
import { useConformance } from 'features/blockly/utils/useConformance'
import {
  type BlockViewMode,
  type DeleteConfirmMode,
  type ViewSettings,
} from 'features/blockly/utils/useViewSettings'
import { MessageText } from 'utils/messages'
import { toggleEditMode } from 'store/reducers/task'
import { BlockState as State } from 'utils/blocklyTypes'
import { RootState } from 'store/reducers'
import { TaskStatus } from 'pages/tasks/types'

interface RightPanelProps {
  backFunction: () => void
  dataTask: State | State[] | null
  workspace: Blockly.WorkspaceSvg | null
  viewSettings: ViewSettings
  onViewSettingsChange: (patch: Partial<ViewSettings>) => void
  onResetViewSettings: () => void
  taskStatus: TaskStatus
  onLifecycleChange: () => void
}

export const RightPanel = ({
  backFunction,
  dataTask,
  workspace,
  viewSettings,
  onViewSettingsChange,
  onResetViewSettings,
  taskStatus,
  onLifecycleChange,
}: RightPanelProps) => {
  const { editMode } = useSelector((state: RootState) => state.task)
  const { id } = useParams()
  const theme = useTheme()
  const dispatch = useDispatch()
  const [actualTask, setActualTask] = React.useState<State | State[] | null>(
    dataTask,
  )
  const { isReady, formattedIssues } = useConformance(workspace)

  const draftTooltip =
    formattedIssues.length > 0
      ? formattedIssues[0]
      : 'Complete all blocks before saving.'

  // ── Lifecycle handlers ────────────────────────────────────────────────────

  const handleSaveDraft = () => {
    void fetchApi({
      url: endpoints.task.saveDraft,
      method: MethodHTTP.PUT,
      body: { id, taskStructure: getBlocklyStructure() },
    }).then(async () => {
      toast.success('Draft saved.')
      onLifecycleChange()
    })
  }

  const handlePublish = () => {
    void fetchApi<{ stale_deps?: number[] }>({
      url: endpoints.task.publish,
      method: MethodHTTP.POST,
      body: { id, taskStructure: getBlocklyStructure() },
    })
      .then(async () => {
        toast.success(MessageText.success)
        onLifecycleChange()
        void dispatch(toggleEditMode())
      })
      .catch((err: Error) => {
        const status = Number(err.name)
        if (status === 409) return
      })
  }

  const handleDiscardDraft = () => {
    void fetchApi({
      url: endpoints.task.discardDraft,
      method: MethodHTTP.POST,
      body: { id },
    }).then(() => {
      toast.success('Changes discarded.')
      onLifecycleChange()
      void dispatch(toggleEditMode())
      backFunction()
    })
  }

  const handleCancel = () => {
    void dispatch(toggleEditMode())
  }

  // ── View settings handlers ────────────────────────────────────────────────

  const handleBlockViewModeChange = (
    _event: React.MouseEvent<HTMLElement>,
    value: BlockViewMode | null,
  ) => {
    if (!value) return
    onViewSettingsChange({ blockViewMode: value })
  }

  const handleDeleteConfirmModeChange = (
    _event: React.MouseEvent<HTMLElement>,
    value: DeleteConfirmMode | null,
  ) => {
    if (!value) return
    onViewSettingsChange({ deleteConfirmMode: value })
  }

  // ── Edit actions ──────────────────────────────────────────────────────────

  const renderEditActions = () => (
    <>
      {taskStatus === 'published_with_draft' && (
        <Alert severity="info" sx={{ mb: 1, fontSize: 12 }}>
          You have unpublished changes. The previous version is still available
          to others.
        </Alert>
      )}

      <Tooltip
        title={
          isReady ? 'All blocks are configured — ready to save.' : draftTooltip
        }
        arrow
        placement="left"
      >
        <Chip
          label={isReady ? 'Ready' : 'Draft'}
          size="small"
          color={isReady ? 'success' : 'default'}
          variant={isReady ? 'filled' : 'outlined'}
          sx={{
            mb: 1,
            width: '100%',
            fontWeight: 600,
            cursor: 'default',
            letterSpacing: '0.04em',
          }}
        />
      </Tooltip>

      <Tooltip
        title={isReady ? '' : draftTooltip}
        arrow
        placement="left"
        disableHoverListener={isReady}
        disableFocusListener={isReady}
      >
        <span style={{ display: 'block' }}>
          <Button
            fullWidth
            variant={isReady ? 'contained' : 'outlined'}
            color={isReady ? 'success' : 'primary'}
            startIcon={<SaveOutlined />}
            onClick={isReady ? handlePublish : handleSaveDraft}
          >
            {isReady ? 'Save' : 'Save draft'}
          </Button>
        </span>
      </Tooltip>

      {/* Show Discard whenever there is a draft (status === published_with_draft).
          All tasks now store published_workspace so reverting is always possible. */}
      {taskStatus === 'published_with_draft' && (
        <Button
          fullWidth
          variant="outlined"
          color="warning"
          onClick={handleDiscardDraft}
          sx={{ mt: 1 }}
        >
          Discard changes
        </Button>
      )}

      <Button fullWidth onClick={handleCancel} sx={{ mt: 1 }}>
        Close without saving
      </Button>
    </>
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        borderLeft: `1px solid ${theme.palette.grey[300]}`,
        paddingLeft: '1rem',
        width: '33.33%',
        overflow: 'auto',
      }}
    >
      {!editMode && (
        <Button
          fullWidth
          variant="contained"
          startIcon={<EditOutlined />}
          onClick={() => void dispatch(toggleEditMode())}
          color="warning"
        >
          Edit
        </Button>
      )}

      {editMode && renderEditActions()}

      <h2>
        <QuestionCircleOutlined /> Instructions &amp; FAQ
      </h2>
      <p>In this graphic interface you can edit your task.</p>
      <ul>
        <li>
          You can drag the blocks from the panel that appears by clicking on
          each category on the right. Then drag these into the workspace.
        </li>
        <li>
          The allowed interlocks will guide you in creating a formally correct
          task.
        </li>
        <li>Via the right-click menu you can undo/redo your changes.</li>
        <li>
          All changes will be lost if you exit without clicking the <i>Save</i>{' '}
          button.
        </li>
      </ul>

      <Divider />

      <Collapse
        key="task-collapse-debug"
        style={{ marginTop: '1rem', marginRight: '1rem' }}
        items={[
          {
            label: 'Task JSON',
            key: 'task-json',
            children: actualTask ? (
              <pre>{JSON.stringify(actualTask, null, 2)}</pre>
            ) : (
              <i>None</i>
            ),
            extra: (
              <>
                <CopyOutlined
                  style={{ marginRight: '1rem' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    void navigator.clipboard
                      .writeText(
                        actualTask ? JSON.stringify(actualTask, null, 2) : '',
                      )
                      .then(() => toast.success(MessageText.copiedInClipboard))
                      .catch(() => undefined)
                  }}
                />
                <SyncOutlined
                  style={{ marginRight: '1rem' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setActualTask(getBlocklyStructure())
                    toast.success(MessageText.success)
                  }}
                />
              </>
            ),
          },
        ]}
      />
    </div>
  )
}
