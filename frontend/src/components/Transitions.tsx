import React, { ReactNode } from 'react'
import { Fade, Box, Grow } from '@mui/material'

interface TransitionProps {
  children: ReactNode
  type?: 'grow' | 'fade' | 'collapse' | 'slide' | 'zoom'
  position?:
    'top-left' | 'top-right' | 'top' | 'bottom-left' | 'bottom-right' | 'bottom'
  ref?: React.Ref<HTMLDivElement>
  displayName?: string
}

export const Transitions = ({
  children,
  position = 'top-left',
  type = 'fade',
  ref,
  ...others
}: TransitionProps) => {
  const typeProps = type || 'grow'
  const transformOriginByPosition = {
    'top-left': '0 0 0',
    'top-right': '100% 0 0',
    top: '50% 0 0',
    'bottom-left': '0 100% 0',
    'bottom-right': '100% 100% 0',
    bottom: '50% 100% 0',
  }
  const positionSX = {
    transformOrigin: transformOriginByPosition[position],
  }

  return (
    <Box ref={ref}>
      {typeProps === 'grow' && (
        <Grow {...others}>
          <Box sx={positionSX}>{children}</Box>
        </Grow>
      )}
      {typeProps === 'fade' && (
        <Fade
          {...others}
          timeout={{
            appear: 0,
            enter: 300,
            exit: 150,
          }}
        >
          <Box sx={positionSX}>{children}</Box>
        </Fade>
      )}
    </Box>
  )
}
