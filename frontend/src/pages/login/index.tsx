import React, { useEffect } from 'react'
import { Box, Typography } from '@mui/material'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'react-toastify'

import { MessageText } from 'utils/messages'
import { useDocumentTitle } from 'hooks/useDocumentTitle'

import { LoginForm } from './LoginForm'
import { LoginWrapper } from './LoginWrapper'

const Login = () => {
  useDocumentTitle('Login')
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
      <Box sx={{ mb: 3, textAlign: 'center' }}>
        <Typography variant="h3" component="h1" sx={{ fontWeight: 600 }}>
          Welcome back
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Sign in to your DTblocklyGPT account.
        </Typography>
      </Box>
      <LoginForm />
    </LoginWrapper>
  )
}

export default Login
