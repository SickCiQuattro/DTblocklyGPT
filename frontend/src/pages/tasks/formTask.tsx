import React, { useCallback, useState } from 'react'
import {
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  FormHelperText,
  Stack,
  TextField,
} from '@mui/material'
import { ArrowUpRight } from 'lucide-react'
import { Formik } from 'formik'
import { toast } from 'react-toastify'
import { string as YupString, object as YupObject } from 'yup'
import { useNavigate } from 'react-router-dom'
import { useDispatch } from 'react-redux'

import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { MessageText, MessageTextMaxLength } from 'utils/messages'
import { activeItem } from 'store/reducers/menu'
import { TaskStatusChip } from 'components/TaskStatusChip'

import { TaskDetailType, TaskStatus } from './types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormTaskProps {
  data: TaskDetailType
  backFunction: () => void
}

interface SaveTaskResponse {
  nameAlreadyExists?: boolean
  id?: number
}

type FormValues = Omit<TaskDetailType, 'code'> & {
  code: Record<string, unknown> | null
}

// ─── Component ────────────────────────────────────────────────────────────────

// This form only ever edits an existing task — every "New Task" flow creates
// the task directly in the Blockly workspace (`/task/new`) and metadata gets
// filled in here afterwards. The publish/save-draft/discard lifecycle lives
// on the workspace's own header (Save & Publish, Discard draft), which is
// where the task's blocks are actually visible — not duplicated here.
export const FormTask = ({ data, backFunction }: FormTaskProps) => {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const [isSaving, setIsSaving] = useState(false)

  const onSubmit = useCallback(
    async (
      values: FormValues,
      { setStatus, setFieldError, setFieldTouched },
    ) => {
      setIsSaving(true)
      try {
        const res = await fetchApi<SaveTaskResponse, FormValues>({
          url: endpoints.home.libraries.task,
          method: MethodHTTP.PUT,
          body: values,
        })
        if (res?.nameAlreadyExists) {
          await setFieldTouched('name', true)
          await setFieldError('name', MessageText.alreadyExists)
          setStatus({ success: false })
          return
        }
        setStatus({ success: true })
        toast.success(MessageText.success)
        backFunction()
      } finally {
        setIsSaving(false)
      }
    },
    [backFunction],
  )

  const currentStatus: TaskStatus = data.status ?? 'draft'

  return (
    <Formik<FormValues>
      initialValues={{
        id: data.id,
        name: data.name ?? '',
        description: data.description ?? '',
        code: data.code ?? null,
        shared: data.shared ?? false,
        task_type: data.task_type ?? 'task',
        status: data.status ?? 'draft',
        signature: data.signature ?? '',
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
          <Stack spacing={2.5}>
            <Stack
              direction="row"
              spacing={1.5}
              sx={{ alignItems: 'center', flexWrap: 'wrap' }}
            >
              <TaskStatusChip status={currentStatus} />
              <Button
                onClick={() => {
                  dispatch(activeItem('tasks'))
                  navigate(`/task/${values.id}`)
                }}
                size="small"
                variant="text"
                title="Open the blocks for this task"
                endIcon={<ArrowUpRight size={14} />}
                sx={{ textTransform: 'none', fontWeight: 500 }}
              >
                Open in workspace
              </Button>
            </Stack>

            <Divider />

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
                fullWidth
              />
              {touched.name && errors.name && (
                <FormHelperText error id="helper-text-name">
                  {errors.name}
                </FormHelperText>
              )}
            </Stack>

            <TextField
              id="description"
              value={values.description}
              name="description"
              label="Description"
              onBlur={handleBlur}
              onChange={handleChange}
              title="Description of the task"
              fullWidth
              multiline
              minRows={2}
            />

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
              label="Shared — visible to other users"
            />

            <Button
              disableElevation
              disabled={isSaving}
              fullWidth
              size="large"
              type="submit"
              variant="contained"
              color="primary"
              title="Save task"
              sx={{
                borderRadius: '8px',
                textTransform: 'none',
                fontWeight: 600,
              }}
            >
              Save
            </Button>
          </Stack>
        </form>
      )}
    </Formik>
  )
}
