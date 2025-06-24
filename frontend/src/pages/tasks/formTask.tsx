import React from 'react'
import {
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  FormHelperText,
  Grid,
  Stack,
  TextField,
} from '@mui/material'
import { Formik } from 'formik'
import { toast } from 'react-toastify'
import { string as YupString, object as YupObject } from 'yup'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BuildOutlined } from '@ant-design/icons'
import { useDispatch } from 'react-redux'

import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { MessageText, MessageTextMaxLength } from 'utils/messages'
import { activeItem, openDrawer } from 'store/reducers/menu'
import { Collapse } from 'antd'
import { TaskDetailType } from './types'

export enum TypeNewTask {
  CHAT = 'chat',
  GRAPHIC = 'graphic',
}

interface FormTaskProps {
  data: TaskDetailType | undefined
  insertMode: boolean
  backFunction: () => void
}

export const FormTask = ({ data, insertMode, backFunction }: FormTaskProps) => {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const [searchParams] = useSearchParams()
  const type = searchParams.get('type')

  const onSubmit = async (
    values: TaskDetailType,
    { setStatus, setSubmitting, setFieldError, setFieldTouched },
  ) => {
    const method = insertMode ? MethodHTTP.POST : MethodHTTP.PUT
    fetchApi({ url: endpoints.home.libraries.task, method, body: values })
      .then(async (res) => {
        if (res && res.nameAlreadyExists) {
          await setFieldTouched('name', true)
          await setFieldError('name', MessageText.alreadyExists)
          setStatus({ success: false })
          return
        }
        const newTaskId = insertMode ? res.id : null
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
        backFunction()
      })
      .finally(() => {
        setSubmitting(false)
      })
  }

  return (
    <Formik
      initialValues={{
        id: data?.id || -1,
        name: data?.name || '',
        description: data?.description || '',
        code: data?.code || '',
        shared: data?.shared || false,
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
            <Grid size={insertMode ? 3 : 2}>
              <Stack spacing={1}>
                <TextField
                  id="name"
                  value={values.name || ''}
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
            <Grid size={8}>
              <Stack spacing={1}>
                <TextField
                  id="description"
                  value={values.description || ''}
                  name="description"
                  label="Description"
                  onBlur={handleBlur}
                  onChange={handleChange}
                  title="Description of the task"
                />
              </Stack>
            </Grid>
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
                              ? JSON.stringify(JSON.parse(values.code), null, 2)
                              : ''}
                          </pre>
                        ),
                      },
                    ]}
                  />
                </Stack>
              </Grid>
            )}
            <Grid size={12}>
              <Button
                disableElevation
                disabled={isSubmitting}
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
          </Grid>
        </form>
      )}
    </Formik>
  )
}
