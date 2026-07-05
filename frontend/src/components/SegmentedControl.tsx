import React from 'react'
import { alpha, useTheme } from '@mui/material/styles'
import {
  ToggleButtonGroup,
  ToggleButtonGroupProps,
  ToggleButton,
} from '@mui/material'

export interface SegmentedControlOption {
  value: string
  label: string
  icon?: React.ReactNode
}

interface SegmentedControlProps extends Omit<
  ToggleButtonGroupProps,
  'children' | 'color'
> {
  options: SegmentedControlOption[]
  /** Pill-on-tint variant for dark surfaces (Digital Twin panel). */
  dark?: boolean
}

// Pill-shaped alternative to a plain ToggleButtonGroup: capsule chrome +
// a floating selected segment, matching the shell's floating-panel language.
// Thin wrapper — forwards every ToggleButtonGroup prop (value/onChange/
// exclusive) untouched, only adds the capsule sx and an options→children map.
export const SegmentedControl = ({
  options,
  dark = false,
  size = 'small',
  sx,
  ...groupProps
}: SegmentedControlProps) => {
  const theme = useTheme()
  const height = size === 'small' ? 30 : 34

  return (
    <ToggleButtonGroup
      size={size}
      {...groupProps}
      sx={[
        {
          bgcolor: dark ? 'rgba(255,255,255,0.08)' : 'grey.100',
          borderRadius: 999,
          padding: '3px',
          gap: '2px',
          height,
          '& .MuiToggleButtonGroup-grouped': {
            border: 0,
            borderRadius: '999px !important',
            textTransform: 'none',
            fontSize: '0.8rem',
            fontWeight: 500,
            lineHeight: 1,
            gap: '6px',
            px: 1.5,
            color: dark ? 'rgba(255,255,255,0.6)' : 'text.secondary',
            '&.Mui-selected': {
              color: dark ? '#fff' : 'text.primary',
              bgcolor: dark
                ? alpha(theme.palette.primary.main, 0.25)
                : 'background.paper',
              boxShadow: dark ? 'none' : '0 1px 2px rgba(0,0,0,0.08)',
              '&:hover': {
                bgcolor: dark
                  ? alpha(theme.palette.primary.main, 0.3)
                  : 'background.paper',
              },
            },
          },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {options.map((opt) => (
        <ToggleButton key={opt.value} value={opt.value} aria-label={opt.label}>
          {opt.icon}
          {opt.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
