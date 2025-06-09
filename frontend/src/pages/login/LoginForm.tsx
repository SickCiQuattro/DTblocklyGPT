import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  FormControl,
  FormHelperText,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  OutlinedInput,
  Stack,
  TextField,
} from '@mui/material'
import { string as YupString, object as YupObject } from 'yup'
import { Formik } from 'formik'
import { EyeOutlined, EyeInvisibleOutlined } from '@ant-design/icons'

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
}

interface LoginFormProps {
  setResetPassword: (value: boolean) => void
}

export const LoginForm = ({ setResetPassword }: LoginFormProps) => {
  const [showPassword, setShowPassword] = useState<boolean>(false)
  const navigate = useNavigate()
  const dispatch = useDispatch()

  const onSubmit = async (
    values: { username: string; password: string },
    { setErrors, setStatus, setSubmitting },
  ) => {
    fetchApi({
      url: endpoints.auth.login,
      method: MethodHTTP.POST,
      body: { username: values.username, password: values.password },
    })
      .then((response: any) => {
        const {
          authError,
          username,
          id,
          group,
        }: { authError: boolean; username: string; id: number; group: string } =
          response
        if (!authError) {
          setToLocalStorage(LocalStorageKey.USER, { username, id, group })
          navigate(defaultPath)
          dispatch(activeItem(defaultOpenItem))
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
          <Grid container spacing={3}>
            <Grid size={12}>
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
            </Grid>
            <Grid size={12}>
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
                            <EyeOutlined />
                          ) : (
                            <EyeInvisibleOutlined />
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
                Login
              </Button>
            </Grid>
            <Grid size={12} sx={{ display: 'none' }}>
              <Button
                fullWidth
                size="small"
                variant="text"
                color="primary"
                onClick={() => setResetPassword(true)}
                disabled
              >
                Forgot the password?
              </Button>
            </Grid>
          </Grid>
        </form>
      )}
    </Formik>
  )
}
