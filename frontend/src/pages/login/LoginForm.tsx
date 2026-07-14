import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  FormControl,
  FormHelperText,
  IconButton,
  InputAdornment,
  InputLabel,
  OutlinedInput,
  Stack,
  TextField,
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

interface LoginFormProps {
  setResetPassword: (value: boolean) => void
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

export const LoginForm = ({ setResetPassword }: LoginFormProps) => {
  const [showPassword, setShowPassword] = useState<boolean>(false)
  const navigate = useNavigate()
  const dispatch = useDispatch()

  const onSubmit = (
    values: LoginFormValues,
    { setErrors, setStatus, setSubmitting }: FormikHelpers<LoginFormValues>,
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
        setStatus({ success: false })

        if (authError) {
          setErrors({
            username: MessageText.invalidCredentials,
            password: MessageText.invalidCredentials,
          })
          return
        }
        setErrors({
          username: MessageText.noConnection,
          password: MessageText.noConnection,
        })
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
        touched,
        values,
      }) => (
        <form noValidate onSubmit={handleSubmit}>
          <Stack spacing={2.5}>
            <Stack spacing={1}>
              <TextField
                id="username-login"
                type="username"
                value={values.username}
                name="username"
                label="Username"
                onBlur={handleBlur}
                onChange={handleChange}
                fullWidth
                error={Boolean(touched.username && errors.username)}
              />
              {touched.username && errors.username && (
                <FormHelperText
                  error
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
                  error={Boolean(touched.password && errors.password)}
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
                    id="helper-text-password-login"
                    style={{ margin: 0, marginTop: 3 }}
                  >
                    {errors.password}
                  </FormHelperText>
                )}
              </FormControl>
            </Stack>
            <Button
              disableElevation
              disabled={isSubmitting}
              fullWidth
              size="large"
              type="submit"
              variant="contained"
              color="primary"
              sx={{
                borderRadius: '8px',
                textTransform: 'none',
                fontWeight: 600,
              }}
            >
              Login
            </Button>
            <Button
              fullWidth
              size="small"
              variant="text"
              color="primary"
              onClick={() => setResetPassword(true)}
              disabled
              sx={{ display: 'none' }}
            >
              Forgot the password?
            </Button>
          </Stack>
        </form>
      )}
    </Formik>
  )
}
