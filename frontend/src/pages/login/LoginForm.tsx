import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  CircularProgress,
  FormControl,
  FormHelperText,
  IconButton,
  InputAdornment,
  InputLabel,
  OutlinedInput,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { string as YupString, object as YupObject } from 'yup'
import { Formik } from 'formik'
import type { FormikHelpers } from 'formik'
import { Eye, EyeOff } from 'lucide-react'
import { useDispatch } from 'react-redux'

import { MessageText, MessageTextMaxLength } from 'utils/messages'
import { USER_GROUP, defaultOpenItem, defaultPath } from 'utils/constants'
import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { LocalStorageKey, setToLocalStorage } from 'utils/localStorageUtils'
import { activeItem } from 'store/reducers/menu'

export interface UserLoginInterface {
  id: string
  username: string
  group: USER_GROUP
  versionServer: string
}

interface LoginFormValues {
  username: string
  password: string
}

interface LoginResponse {
  authError: boolean
  username: string
  id: number
  group: USER_GROUP
}

export const LoginForm = () => {
  const [showPassword, setShowPassword] = useState<boolean>(false)
  const navigate = useNavigate()
  const dispatch = useDispatch()

  const onSubmit = (
    values: LoginFormValues,
    { setStatus, setSubmitting }: FormikHelpers<LoginFormValues>,
  ) => {
    void fetchApi<LoginResponse, LoginFormValues>({
      url: endpoints.auth.login,
      method: MethodHTTP.POST,
      body: { username: values.username, password: values.password },
    })
      .then((response) => {
        const { authError, username, id, group } = response
        if (!authError) {
          setToLocalStorage(LocalStorageKey.USER, { username, id, group })
          void navigate(defaultPath)
          void dispatch(activeItem(defaultOpenItem))
          setStatus({ success: true })
          return
        }
        // One form-level message, not the same text duplicated under both
        // fields — the failure is the username/password combination, not
        // either field individually.
        setStatus({
          success: false,
          formError: MessageText.invalidCredentials,
        })
      })
      .catch(() => {
        setStatus({ success: false, formError: MessageText.noConnection })
      })
      .finally(() => {
        setSubmitting(false)
      })
  }

  return (
    <Formik
      initialValues={{ username: '', password: '' }}
      validationSchema={YupObject().shape({
        username: YupString()
          .max(255, MessageTextMaxLength(255))
          .required(MessageText.requiredField),
        password: YupString()
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
        status,
        touched,
        values,
      }) => (
        <form noValidate onSubmit={handleSubmit}>
          <Stack spacing={2.5}>
            <Stack spacing={1}>
              <TextField
                id="username-login"
                type="text"
                autoComplete="username"
                required
                value={values.username}
                name="username"
                label="Username"
                onBlur={handleBlur}
                onChange={handleChange}
                fullWidth
                error={Boolean(touched.username && errors.username)}
                aria-invalid={Boolean(touched.username && errors.username)}
                aria-describedby={
                  touched.username && errors.username
                    ? 'helper-text-username-login'
                    : undefined
                }
              />
              {touched.username && errors.username && (
                <FormHelperText
                  error
                  role="alert"
                  id="helper-text-username-login"
                  style={{ marginTop: 3 }}
                >
                  {errors.username}
                </FormHelperText>
              )}
            </Stack>
            <Stack spacing={1}>
              <FormControl>
                <InputLabel
                  htmlFor="password-login"
                  error={Boolean(touched.password && errors.password)}
                >
                  Password
                </InputLabel>
                <OutlinedInput
                  fullWidth
                  required
                  autoComplete="current-password"
                  error={Boolean(touched.password && errors.password)}
                  aria-invalid={Boolean(touched.password && errors.password)}
                  aria-describedby={
                    touched.password && errors.password
                      ? 'helper-text-password-login'
                      : undefined
                  }
                  id="password-login"
                  type={showPassword ? 'text' : 'password'}
                  value={values.password}
                  name="password"
                  label="Password"
                  onBlur={handleBlur}
                  onChange={handleChange}
                  endAdornment={
                    <InputAdornment position="end">
                      <IconButton
                        aria-label="toggle password visibility"
                        onClick={() => setShowPassword(!showPassword)}
                        onMouseDown={(e) => e.preventDefault()}
                        edge="end"
                        size="large"
                      >
                        {showPassword ? (
                          <Eye size={16} />
                        ) : (
                          <EyeOff size={16} />
                        )}
                      </IconButton>
                    </InputAdornment>
                  }
                />
                {touched.password && errors.password && (
                  <FormHelperText
                    error
                    role="alert"
                    id="helper-text-password-login"
                    style={{ margin: 0, marginTop: 3 }}
                  >
                    {errors.password}
                  </FormHelperText>
                )}
              </FormControl>
            </Stack>
            {status?.success === false && status.formError && (
              <FormHelperText error role="alert" sx={{ textAlign: 'center' }}>
                {status.formError}
              </FormHelperText>
            )}
            <Button
              disableElevation
              disabled={isSubmitting}
              fullWidth
              size="large"
              type="submit"
              variant="contained"
              color="primary"
              startIcon={
                isSubmitting ? (
                  <CircularProgress size={16} color="inherit" />
                ) : undefined
              }
              sx={{
                borderRadius: '8px',
                textTransform: 'none',
                fontWeight: 600,
              }}
            >
              {isSubmitting ? 'Signing in…' : 'Login'}
            </Button>
            <Typography variant="body2" color="text.secondary" align="center">
              Forgot your password? Ask your administrator to reset it.
            </Typography>
          </Stack>
        </form>
      )}
    </Formik>
  )
}
