import React, { forwardRef, ReactNode } from 'react'
import { Fade, Box, Grow } from '@mui/material'

interface TransitionProps {
  children: ReactNode
  type?: 'grow' | 'fade' | 'collapse' | 'slide' | 'zoom'
  position?:
    | 'top-left'
    | 'top-right'
    | 'top'
    | 'bottom-left'
    | 'bottom-right'
    | 'bottom'
}

export const Transitions = forwardRef(
  (
    {
      children,
      position = 'top-left',
      type = 'fade',
      ...others
    }: TransitionProps,
    ref,
  ) => {
    const typeProps = type || 'grow'
    const positionProps = position || 'top-left'
    let positionSX = {
      transformOrigin: '0 0 0',
    }

    switch (positionProps) {
      case 'top-right':
      case 'top':
      case 'bottom-left':
      case 'bottom-right':
      case 'bottom':
      case 'top-left':
      default:
        positionSX = {
          transformOrigin: '0 0 0',
        }
        break
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
  },
)

Transitions.displayName = 'Transitions'
