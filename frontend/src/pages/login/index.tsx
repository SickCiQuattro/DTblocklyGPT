import React, { useEffect, useState } from 'react'
import { Grid, Stack, Typography } from '@mui/material'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'react-toastify'

import { ResetPasswordForm } from 'pages/login/ResetPasswordForm'
import { MessageText } from 'utils/messages'
import { LoginForm } from './LoginForm'
import { LoginWrapper } from './LoginWrapper'

const Login = () => {
  const [resetPassword, setResetPassword] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const expired = !!searchParams.get('expired')

  useEffect(() => {
    if (expired) {
      toast.error(MessageText.sessioneExpired)
      setSearchParams(undefined)
    }
  }, [expired, setSearchParams])

  return (
    <LoginWrapper>
      <Grid container spacing={3}>
        <Grid size={12}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="baseline"
            sx={{ mb: { xs: -0.5, sm: 0.5 } }}
          >
            <Typography variant="h3">
              {resetPassword ? 'Reset password' : 'Login'}
            </Typography>
          </Stack>
        </Grid>
        <Grid size={12}>
          {!resetPassword && <LoginForm setResetPassword={setResetPassword} />}
          {resetPassword && (
            <ResetPasswordForm setResetPassword={setResetPassword} />
          )}
        </Grid>
      </Grid>
    </LoginWrapper>
  )
}

export default Login
