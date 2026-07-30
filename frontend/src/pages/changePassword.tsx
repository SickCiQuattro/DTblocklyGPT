import React from 'react'
import { Button, FormHelperText, Grid, Stack, TextField } from '@mui/material'
import { Formik } from 'formik'
import type { FormikHelpers } from 'formik'
import { string as YupString, object as YupObject, ref as YupRef } from 'yup'
import { toast } from 'react-toastify'
import { useNavigate } from 'react-router-dom'
import { useDispatch } from 'react-redux'

import { MainCard } from 'components/MainCard'
import {
  MessageText,
  MessageTextMinLength,
  MessageTextMaxLength,
} from 'utils/messages'
import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { LocalStorageKey, getFromLocalStorage } from 'utils/localStorageUtils'
import { defaultPath } from 'utils/constants'
import { activeItem } from 'store/reducers/menu'
import { useDocumentTitle } from 'hooks/useDocumentTitle'

interface ChangePasswordFormValues {
  oldPassword: string
  newPassword: string
  confirmNewPassword: string
}

interface ChangePasswordResponse {
  wrongPassword?: boolean
}

const ChangePassword = () => {
  useDocumentTitle('Change Password')
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const storedUser: unknown = getFromLocalStorage(LocalStorageKey.USER)
  const userId =
    typeof storedUser === 'object' &&
    storedUser !== null &&
    'id' in storedUser &&
    (typeof storedUser.id === 'string' || typeof storedUser.id === 'number')
      ? Number(storedUser.id)
      : null

  return (
    <MainCard
      title="Change password"
      subtitle="Here you can edit your password. The password must be at least 8 characters."
    >
      <Formik<ChangePasswordFormValues>
        initialValues={{
          oldPassword: '',
          newPassword: '',
          confirmNewPassword: '',
        }}
        validationSchema={YupObject().shape({
          oldPassword: YupString().required(MessageText.requiredField),
          newPassword: YupString()
            .min(8, MessageTextMinLength(8))
            .max(255, MessageTextMaxLength(255))
            .required(MessageText.requiredField),
          confirmNewPassword: YupString()
            .required(MessageText.requiredField)
            .oneOf([YupRef('newPassword')], MessageText.passwordMismatch),
        })}
        onSubmit={(
          values,
          {
            setStatus,
            setSubmitting,
            setFieldTouched,
            setFieldError,
          }: FormikHelpers<ChangePasswordFormValues>,
        ) => {
          const { newPassword, oldPassword } = values
          if (newPassword === oldPassword) {
            void setFieldTouched('newPassword', true)
            setFieldError('newPassword', MessageText.newPasswordEqualOld)
            setStatus({ success: false })
            return
          }

          if (userId === null || Number.isNaN(userId)) {
            setStatus({ success: false })
            setSubmitting(false)
            return
          }

          void fetchApi<
            ChangePasswordResponse,
            { id: number; oldPassword: string; newPassword: string }
          >({
            url: endpoints.home.user.changePassword,
            method: MethodHTTP.POST,
            body: {
              id: userId,
              oldPassword,
              newPassword,
            },
          })
            .then((res) => {
              if (res?.wrongPassword) {
                void setFieldTouched('oldPassword', true)
                setFieldError('oldPassword', MessageText.incorrectPassword)
                setStatus({ success: false })
                return
              }
              toast.success(MessageText.success)
              setStatus({ success: true })
              void dispatch(activeItem('tasks'))
              void navigate(defaultPath)
            })
            .finally(() => {
              setSubmitting(false)
            })
        }}
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
            <Grid container spacing={4}>
              <Grid size={12}>
                <Stack spacing={1}>
                  <TextField
                    id="oldPassword"
                    type="password"
                    value={values.oldPassword}
                    name="oldPassword"
                    label="Current password"
                    onBlur={handleBlur}
                    onChange={handleChange}
                    error={Boolean(touched.oldPassword && errors.oldPassword)}
                    title="Enter your current password"
                  />
                  {touched.oldPassword && errors.oldPassword && (
                    <FormHelperText
                      error
                      id="standard-weight-helper-text-oldPassword"
                    >
                      {errors.oldPassword}
                    </FormHelperText>
                  )}
                </Stack>
              </Grid>
              <Grid size={12}>
                <Stack spacing={1}>
                  <TextField
                    error={Boolean(touched.newPassword && errors.newPassword)}
                    id="newPassword"
                    type="password"
                    value={values.newPassword}
                    name="newPassword"
                    label="New password"
                    onBlur={handleBlur}
                    onChange={handleChange}
                    title="Enter your new password"
                  />
                  {touched.newPassword && errors.newPassword && (
                    <FormHelperText
                      error
                      id="standard-weight-helper-text-newPassword"
                    >
                      {errors.newPassword}
                    </FormHelperText>
                  )}
                </Stack>
              </Grid>
              <Grid size={12}>
                <Stack spacing={1}>
                  <TextField
                    error={Boolean(
                      touched.confirmNewPassword && errors.confirmNewPassword,
                    )}
                    id="confirmNewPassword"
                    type="password"
                    value={values.confirmNewPassword}
                    name="confirmNewPassword"
                    label="Confirm new password"
                    onBlur={handleBlur}
                    onChange={handleChange}
                    fullWidth={false}
                    title="Confirm your new password"
                  />
                  {touched.confirmNewPassword && errors.confirmNewPassword && (
                    <FormHelperText
                      error
                      id="standard-weight-helper-text-confirmNewPassword"
                    >
                      {errors.confirmNewPassword}
                    </FormHelperText>
                  )}
                </Stack>
              </Grid>
              <Grid size={3}>
                <Button
                  disabled={isSubmitting}
                  size="large"
                  type="submit"
                  variant="contained"
                  color="primary"
                  title="Save your new password"
                >
                  Save
                </Button>
              </Grid>
            </Grid>
          </form>
        )}
      </Formik>
    </MainCard>
  )
}

export default ChangePassword
