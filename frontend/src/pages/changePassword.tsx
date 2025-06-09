import React from 'react'
import { Button, FormHelperText, Grid, Stack, TextField } from '@mui/material'
import { Formik } from 'formik'
import { string as YupString, object as YupObject, ref as YupRef } from 'yup'
import { toast } from 'react-toastify'

import { MainCard } from 'components/MainCard'
import {
  MessageText,
  MessageTextMinLength,
  MessageTextMaxLength,
} from 'utils/messages'
import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { LocalStorageKey, getFromLocalStorage } from 'utils/localStorageUtils'
import { useNavigate } from 'react-router-dom'
import { defaultPath } from 'utils/constants'
import { useDispatch } from 'react-redux'
import { activeItem } from 'store/reducers/menu'

const ChangePassword = () => {
  const navigate = useNavigate()
  const dispatch = useDispatch()

  return (
    <MainCard
      title="Change password"
      subtitle="Here you can edit your password. The password must be at least 8 characters."
    >
      <Formik
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
        onSubmit={async (
          values,
          { setStatus, setSubmitting, setFieldTouched, setFieldError },
        ) => {
          const { newPassword, oldPassword } = values
          if (newPassword === oldPassword) {
            await setFieldTouched('newPassword', true)
            await setFieldError('newPassword', MessageText.newPasswordEqualOld)
            setStatus({ success: false })
            return
          }

          fetchApi({
            url: endpoints.home.user.changePassword,
            method: MethodHTTP.POST,
            body: {
              id: getFromLocalStorage(LocalStorageKey.USER).id,
              oldPassword,
              newPassword,
            },
          })
            .then(async (res) => {
              if (res && res.wrongPassword) {
                await setFieldTouched('oldPassword', true)
                await setFieldError(
                  'oldPassword',
                  MessageText.incorrectPassword,
                )
                setStatus({ success: false })
                return
              }
              toast.success(MessageText.success)
              setStatus({ success: true })
              dispatch(activeItem('homepage'))
              navigate(defaultPath)
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
          <form
            noValidate
            onSubmit={handleSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault()
            }}
          >
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
