import React, { useCallback, useState } from 'react'
import {
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  FormHelperText,
  Grid,
  Stack,
  TextField,
  Tooltip,
} from '@mui/material'
import { CheckCircle, FileEdit, Trash2 } from 'lucide-react'
import { Formik } from 'formik'
import { toast } from 'react-toastify'
import { string as YupString, object as YupObject } from 'yup'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BuildOutlined } from '@ant-design/icons'
import { useDispatch } from 'react-redux'
import { Collapse } from 'antd'

import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { MessageText, MessageTextMaxLength } from 'utils/messages'
import { activeItem, openDrawer } from 'store/reducers/menu'

import { TaskDetailType, TaskStatus, TaskTypeField } from './types'

// ─── Lifecycle guard helpers ──────────────────────────────────────────────────

const isDraft = (status: TaskStatus): boolean => status === 'draft'

const hasUnpublishedDraft = (status: TaskStatus): boolean =>
  status === 'published_with_draft'

// ─── Status chip metadata ──────────────────────────────────────────────────────

type ChipColor = 'warning' | 'success' | 'info'

function statusChip(status: TaskStatus): { label: string; color: ChipColor } {
  if (isDraft(status)) return { label: 'Draft', color: 'warning' }
  if (hasUnpublishedDraft(status))
    return { label: 'Draft in progress', color: 'info' }
  return { label: 'Published', color: 'success' }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export enum TypeNewTask {
  CHAT = 'chat',
  GRAPHIC = 'graphic',
  MULTIMODAL = 'multimodal',
}

interface FormTaskProps {
  data: TaskDetailType | undefined
  insertMode: boolean
  backFunction: () => void
  onLifecycleChange?: () => void | Promise<void>
  taskType?: TaskTypeField
}

interface SaveTaskResponse {
  nameAlreadyExists?: boolean
  id?: number
}

type FormValues = Omit<TaskDetailType, 'code'> & {
  code: Record<string, unknown> | null
}

// ─── Component ────────────────────────────────────────────────────────────────

export const FormTask = ({
  data,
  insertMode,
  backFunction,
  onLifecycleChange,
  taskType = 'task',
}: FormTaskProps) => {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const [searchParams] = useSearchParams()
  const type = searchParams.get('type')

  const [lifecycleLoading, setLifecycleLoading] = useState(false)

  // ── Formik submit (metadata: name / description / shared) ──────────────────

  const onSubmit = async (
    values: FormValues,
    { setStatus, setSubmitting, setFieldError, setFieldTouched },
  ) => {
    const method = insertMode ? MethodHTTP.POST : MethodHTTP.PUT
    void fetchApi<SaveTaskResponse, FormValues>({
      url: endpoints.home.libraries.task,
      method,
      body: values,
    })
      .then(async (res) => {
        if (res?.nameAlreadyExists) {
          await setFieldTouched('name', true)
          await setFieldError('name', MessageText.alreadyExists)
          setStatus({ success: false })
          return
        }
        const newTaskId = insertMode ? (res?.id ?? null) : null
        setStatus({ success: true })
        if (!type) toast.success(MessageText.success)
        if (type === TypeNewTask.CHAT) {
          dispatch(openDrawer(false))
          navigate(`/chat/${newTaskId}`)
          return
        }
        if (type === TypeNewTask.GRAPHIC) {
          dispatch(openDrawer(false))
          navigate(`/graphic/${newTaskId}?newTask=true`)
          return
        }
        if (type === TypeNewTask.MULTIMODAL) {
          dispatch(openDrawer(false))
          navigate(`/multimodal/${newTaskId}?newTask=true`)
          return
        }
        backFunction()
      })
      .finally(() => {
        setSubmitting(false)
      })
  }

  // ── Lifecycle actions ───────────────────────────────────────────────────────

  const handlePublish = useCallback(async () => {
    if (!data?.id) return
    setLifecycleLoading(true)
    try {
      await fetchApi({
        url: endpoints.task.publish,
        method: MethodHTTP.POST,
        body: { id: data.id, taskStructure: data.code ?? null },
      })
      toast.success('Task published successfully')
      await onLifecycleChange?.()
    } catch {
      toast.error('Error publishing task')
    } finally {
      setLifecycleLoading(false)
    }
  }, [data?.id, data?.code, onLifecycleChange])

  const handleSaveDraft = useCallback(async () => {
    if (!data?.id) return
    setLifecycleLoading(true)
    try {
      await fetchApi({
        url: endpoints.task.saveDraft,
        method: MethodHTTP.PUT,
        body: { id: data.id, taskStructure: data.code ?? null },
      })
      toast.success('Draft saved')
      await onLifecycleChange?.()
    } catch {
      toast.error('Error saving draft')
    } finally {
      setLifecycleLoading(false)
    }
  }, [data?.id, data?.code, onLifecycleChange])

  const handleDiscardDraft = useCallback(async () => {
    if (!data?.id) return
    setLifecycleLoading(true)
    try {
      await fetchApi({
        url: endpoints.task.discardDraft,
        method: MethodHTTP.POST,
        body: { id: data.id },
      })
      toast.success('Draft discarded — published version restored')
      await onLifecycleChange?.()
    } catch {
      toast.error('Error discarding draft')
    } finally {
      setLifecycleLoading(false)
    }
  }, [data?.id, onLifecycleChange])

  // ── Render ──────────────────────────────────────────────────────────────────

  const currentStatus: TaskStatus = data?.status ?? 'draft'
  const { label: chipLabel, color: chipColor } = statusChip(currentStatus)

  return (
    <Formik<FormValues>
      initialValues={{
        id: data?.id ?? -1,
        name: data?.name ?? '',
        description: data?.description ?? '',
        code: data?.code ?? null,
        shared: data?.shared ?? false,
        task_type: data?.task_type ?? taskType,
        status: data?.status ?? 'draft',
        signature: data?.signature ?? '',
      }}
      validationSchema={YupObject().shape({
        name: YupString()
          .max(255, MessageTextMaxLength(255))
          .required(MessageText.requiredField),
      })}
      onSubmit={onSubmit}
    >
      {({
        errors,
        handleBlur,
        handleChange,
        handleSubmit,
        isSubmitting,
        touched,
        values,
        setFieldValue,
      }) => (
        <form
          noValidate
          onSubmit={handleSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault()
          }}
        >
          <Grid container spacing={3} columns={{ xs: 1, sm: 6, md: 12 }}>
            {/* ── Graphic shortcut ── */}
            {!insertMode && (
              <Grid size={1}>
                <Stack spacing={1}>
                  <Button
                    onClick={() => {
                      dispatch(openDrawer(false))
                      dispatch(activeItem('definegraphic'))
                      navigate(`/graphic/${values.id}`)
                    }}
                    color="primary"
                    aria-label="detail"
                    size="medium"
                    title="Go to graphic interface"
                    startIcon={<BuildOutlined style={{ fontSize: '2em' }} />}
                  >
                    Graphic
                  </Button>
                </Stack>
              </Grid>
            )}

            {/* ── Name ── */}
            <Grid size={insertMode ? 3 : 2}>
              <Stack spacing={1}>
                <TextField
                  id="name"
                  value={values.name}
                  name="name"
                  label="Name"
                  onBlur={handleBlur}
                  onChange={handleChange}
                  error={Boolean(touched.name && errors.name)}
                  title="Name of the task"
                />
                {touched.name && errors.name && (
                  <FormHelperText error id="helper-text-name">
                    {errors.name}
                  </FormHelperText>
                )}
              </Stack>
            </Grid>

            {/* ── Description ── */}
            <Grid size={8}>
              <Stack spacing={1}>
                <TextField
                  id="description"
                  value={values.description}
                  name="description"
                  label="Description"
                  onBlur={handleBlur}
                  onChange={handleChange}
                  title="Description of the task"
                />
              </Stack>
            </Grid>

            {/* ── Shared ── */}
            <Grid size={1}>
              <Stack spacing={1}>
                <FormControlLabel
                  control={
                    <Checkbox
                      id="shared"
                      value={values.shared}
                      name="shared"
                      onBlur={handleBlur}
                      onChange={() => setFieldValue('shared', !values.shared)}
                      checked={values.shared}
                    />
                  }
                  title="Share this task with other users"
                  label="Shared"
                />
              </Stack>
            </Grid>

            <Divider />

            {/* ── Debug JSON ── */}
            {!insertMode && (
              <Grid size={12}>
                <Stack spacing={1}>
                  <Collapse
                    key="task-collapse-debug"
                    items={[
                      {
                        label: 'Task JSON',
                        key: 'task-json',
                        children: (
                          <pre>
                            {values.code
                              ? JSON.stringify(values.code, null, 2)
                              : ''}
                          </pre>
                        ),
                      },
                    ]}
                  />
                </Stack>
              </Grid>
            )}

            {/* ── Save metadata ── */}
            <Grid size={12}>
              <Button
                disableElevation
                disabled={isSubmitting || lifecycleLoading}
                fullWidth
                size="large"
                type="submit"
                variant="contained"
                color="primary"
                title="Save task"
              >
                Save
              </Button>
            </Grid>

            {/* ── Lifecycle toolbar ── */}
            {!insertMode && (
              <>
                <Divider sx={{ width: '100%' }} />

                <Grid size={12}>
                  <Stack
                    direction="row"
                    spacing={1.5}
                    sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    {/* Status badge */}
                    <Chip
                      size="small"
                      label={chipLabel}
                      color={chipColor}
                      variant="outlined"
                    />
                  </Stack>
                </Grid>
              </>
            )}
          </Grid>
        </form>
      )}
    </Formik>
  )
}
