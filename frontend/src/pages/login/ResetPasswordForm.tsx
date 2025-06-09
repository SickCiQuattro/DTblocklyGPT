import React from 'react'
import { Button, FormHelperText, Grid, Stack, TextField } from '@mui/material'
import { string as YupString, object as YupObject } from 'yup'
import { Formik } from 'formik'
import { toast } from 'react-toastify'

import { MessageText, MessageTextMaxLength } from 'utils/messages'
import { fetchApi } from 'services/api'

interface ResetPasswordFormProps {
  setResetPassword: (value: boolean) => void
}

export const ResetPasswordForm = ({
  setResetPassword,
}: ResetPasswordFormProps) => {
  const onSubmit = async (
    values: { email: string },
    { setStatus, setSubmitting },
  ) => {
    fetchApi('aaa')
      .then((res) => {
        if (res?.bool) {
          toast.success(MessageText.success)
          setStatus({ success: true })
          return
        }
        toast.error(MessageText.serverError)
        setStatus({ success: false })
      })
      .finally(() => {
        setSubmitting(false)
      })
  }

  return (
    <Formik
      initialValues={{ email: '' }}
      validationSchema={YupObject().shape({
        email: YupString()
          .email(MessageText.emailNotValid)
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
      }) => (
        <form
          noValidate
          onSubmit={handleSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault()
          }}
        >
          <Grid container spacing={3}>
            <Grid size={12}>
              <Stack spacing={1}>
                <TextField
                  id="email-login"
                  type="email"
                  value={values.email}
                  name="email"
                  label="Email"
                  onBlur={handleBlur}
                  onChange={handleChange}
                  fullWidth
                  error={Boolean(touched.email && errors.email)}
                />
                {touched.email && errors.email && (
                  <FormHelperText
                    error
                    id="helper-text-email-login"
                    style={{ marginTop: 3 }}
                  >
                    {errors.email}
                  </FormHelperText>
                )}
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
              >
                Reset password
              </Button>
            </Grid>
            <Grid size={12}>
              <Button
                fullWidth
                size="small"
                variant="text"
                color="primary"
                onClick={() => setResetPassword(false)}
              >
                Back to login
              </Button>
            </Grid>
          </Grid>
        </form>
      )}
    </Formik>
  )
}
