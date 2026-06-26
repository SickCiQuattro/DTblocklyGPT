import type { SxProps, Theme } from '@mui/material'

/**
 * One coherent elevation for every editor popover/menu (context menu, shadow
 * "+" picker, ⋯ More, Settings, Ctrl/Cmd+K search). Pair with `elevation={0}`
 * so this is the only shadow. Each surface spreads this and adds its own layout
 * sx (padding, width, mt). Tuned to the workspace controls / tooltip shadows.
 */
export const MENU_PAPER_SX: SxProps<Theme> = {
  borderRadius: '12px',
  border: '1px solid #E2E8F0',
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.12)',
}
