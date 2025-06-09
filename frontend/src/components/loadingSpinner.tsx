import React from 'react'
import { Spin } from 'antd'

export const LoadingSpinner = () => (
  <Spin
    size="large"
    style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
    }}
  />
)
