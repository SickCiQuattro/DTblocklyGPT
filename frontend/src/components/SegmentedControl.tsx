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
  /** Overrides the default indigo selected-state color for this option only
   * (dark variant). E.g. distinguishing Simulate (green) from Run on robot
   * (amber) — options without it keep the shared default. */
  activeColor?: string
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
            // Disabled has to be written here, not left to MUI. ToggleButton's
            // own `&.Mui-disabled { color: action.disabled }` is a (0,2,0)
            // rule; the two rules above are descendant selectors at (0,3,0)
            // and win, so a disabled group kept the exact colours of an
            // enabled one. The robot panel locks its Live-view control for the
            // whole duration of a run — the operator clicked a control that
            // looked live, got no cursor change, no hover, no response, while
            // an arm was moving. Silent non-response is the worst answer a
            // control can give.
            //
            // Both states are restyled: an unselected pill fades, and the
            // SELECTED pill has to lose its accent fill too, or the one
            // segment the eye goes to still reads as available.
            '&.Mui-disabled': {
              color: dark ? 'rgba(255,255,255,0.28)' : 'text.disabled',
            },
            '&.Mui-selected.Mui-disabled': {
              color: dark ? 'rgba(255,255,255,0.45)' : 'text.disabled',
              bgcolor: dark ? 'rgba(255,255,255,0.05)' : 'grey.200',
            },
          },
          // The capsule itself recedes, so the whole control reads as one
          // locked object rather than as pills that happen to be pale.
          '&.Mui-disabled, &:has(.Mui-disabled)': {
            bgcolor: dark ? 'rgba(255,255,255,0.03)' : 'grey.50',
          },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {options.map((opt) => (
        <ToggleButton
          key={opt.value}
          value={opt.value}
          aria-label={opt.label}
          sx={
            opt.activeColor
              ? {
                  '&.Mui-selected': {
                    bgcolor: dark
                      ? alpha(opt.activeColor, 0.25)
                      : alpha(opt.activeColor, 0.12),
                    '&:hover': {
                      bgcolor: dark
                        ? alpha(opt.activeColor, 0.3)
                        : alpha(opt.activeColor, 0.16),
                    },
                  },
                }
              : undefined
          }
        >
          {opt.icon}
          {opt.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
