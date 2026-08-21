import React from 'react'
import {
  Button,
  FormControl,
  FormHelperText,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material'
import { Formik } from 'formik'
import { toast } from 'react-toastify'
import {
  string as YupString,
  object as YupObject,
  number as YupNumber,
} from 'yup'

import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { MessageText, MessageTextMaxLength } from 'utils/messages'

import { RoleType, UserDetailType } from './types'

interface FormUserProps {
  dataUser: UserDetailType | undefined
  dataRoles: RoleType[]
  insertMode: boolean
  backFunction: () => void
}

interface SaveUserResponse {
  usernameAlreadyExists?: boolean
}

export const FormUser = ({
  dataUser,
  dataRoles,
  insertMode,
  backFunction,
}: FormUserProps) => {
  const onSubmit = async (
    values: UserDetailType,
    { setStatus, setSubmitting, setFieldTouched, setFieldError },
  ) => {
    const method = insertMode ? MethodHTTP.POST : MethodHTTP.PUT
    void fetchApi<SaveUserResponse, UserDetailType>({
      url: endpoints.home.management.user,
      method,
      body: values,
    })
      .then(async (res) => {
        if (res?.usernameAlreadyExists) {
          await setFieldTouched('username', true)
          await setFieldError('username', MessageText.alreadyExists)
          setStatus({ success: false })
          return
        }
        setStatus({ success: true })
        toast.success(MessageText.success)
        backFunction()
      })
      .catch(() => {
        setStatus({ success: false })
      })
      .finally(() => {
        setSubmitting(false)
      })
  }

  return (
    <Formik
      initialValues={{
        id: dataUser?.id || -1,
        username: dataUser?.username || '',
        email: dataUser?.email || '',
        first_name: dataUser?.first_name || '',
        last_name: dataUser?.last_name || '',
        role: dataUser?.role || null,
      }}
      validationSchema={YupObject().shape({
        username: YupString()
          .max(255, MessageTextMaxLength(255))
          .required(MessageText.requiredField),
        role: YupNumber()
          .required(MessageText.requiredField)
          .min(0, MessageText.requiredField),
        email: YupString()
          .email(MessageText.emailNotValid)
          .max(255, MessageTextMaxLength(255)),
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
      }) => (
        <form noValidate onSubmit={handleSubmit}>
          <Grid container spacing={3} columns={{ xs: 1, sm: 6, md: 12 }}>
            <Grid size={2}>
              <Stack spacing={1}>
                <TextField
                  id="username"
                  value={values.username || ''}
                  name="username"
                  label="Username"
                  required
                  onBlur={handleBlur}
                  onChange={handleChange}
                  error={Boolean(touched.username && errors.username)}
                  aria-invalid={Boolean(touched.username && errors.username)}
                  aria-describedby={
                    touched.username && errors.username
                      ? 'helper-text-username'
                      : undefined
                  }
                  title="Username of the user account"
                />
                {touched.username && errors.username && (
                  <FormHelperText error role="alert" id="helper-text-username">
                    {errors.username}
                  </FormHelperText>
                )}
              </Stack>
            </Grid>
            <Grid size={2}>
              <Stack spacing={1}>
                <TextField
                  id="email"
                  value={values.email || ''}
                  name="email"
                  label="Email"
                  onBlur={handleBlur}
                  onChange={handleChange}
                  error={Boolean(touched.email && errors.email)}
                  aria-invalid={Boolean(touched.email && errors.email)}
                  aria-describedby={
                    touched.email && errors.email
                      ? 'helper-text-email'
                      : undefined
                  }
                  title="Email of the user account"
                />
                {touched.email && errors.email && (
                  <FormHelperText error role="alert" id="helper-text-email">
                    {errors.email}
                  </FormHelperText>
                )}
              </Stack>
            </Grid>
            <Grid size={2}>
              <Stack spacing={1}>
                <TextField
                  id="first_name"
                  value={values.first_name || ''}
                  name="first_name"
                  label="First name"
                  onBlur={handleBlur}
                  onChange={handleChange}
                  title="First name of the user account"
                />
              </Stack>
            </Grid>
            <Grid size={2}>
              <Stack spacing={1}>
                <TextField
                  id="last_name"
                  value={values.last_name || ''}
                  name="last_name"
                  label="Last name"
                  onBlur={handleBlur}
                  onChange={handleChange}
                  title="Last name of the user account"
                />
              </Stack>
            </Grid>
            <Grid size={4}>
              <Stack spacing={1}>
                <FormControl fullWidth>
                  <InputLabel id="role-label" required>
                    Role
                  </InputLabel>
                  <Select
                    labelId="role-label"
                    id="role"
                    value={values.role || ''}
                    label="Role"
                    name="role"
                    required
                    onBlur={handleBlur}
                    onChange={handleChange}
                    error={Boolean(touched.role && errors.role)}
                    aria-invalid={Boolean(touched.role && errors.role)}
                    aria-describedby={
                      touched.role && errors.role
                        ? 'helper-text-role'
                        : undefined
                    }
                    title="Select the role of the user account. Managers can also create and edit user accounts and robots in the fleet"
                  >
                    {dataRoles?.map((role) => (
                      <MenuItem value={role.id} key={role.id}>
                        {role.name}
                      </MenuItem>
                    ))}
                  </Select>
                  {touched.role && errors.role && (
                    <FormHelperText error role="alert" id="helper-text-role">
                      {errors.role}
                    </FormHelperText>
                  )}
                </FormControl>
              </Stack>
            </Grid>
            <Grid size={12}>
              <Button
                disableElevation
                disabled={isSubmitting}
                fullWidth
                size="large"
                type="submit"
                variant="contained"
                color="primary"
                title="Save user account"
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
