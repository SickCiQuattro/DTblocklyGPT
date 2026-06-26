import { Box, Divider, Typography } from '@mui/material'

// Single source for the group-header height. The open-mode label and the
// collapsed-mode spacer BOTH use it, so a group's first item lands at the same Y
// in either state — toggling the rail never shifts items vertically.
export const NAV_GROUP_HEADER_HEIGHT = 28

interface NavGroupHeaderProps {
  title?: string
  drawerOpen: boolean
}

export const NavGroupHeader = ({ title, drawerOpen }: NavGroupHeaderProps) => {
  if (!drawerOpen || !title) {
    // Reserve the exact same height when collapsed (or unlabeled groups), and
    // draw a short hairline so adjacent groups read as separate regions at the
    // icon-only width (Gestalt: common region).
    return (
      <Box
        aria-hidden
        sx={{
          height: NAV_GROUP_HEADER_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Divider sx={{ width: 24, borderColor: 'rgba(0, 0, 0, 0.08)' }} />
      </Box>
    )
  }

  return (
    <Box
      sx={{
        height: NAV_GROUP_HEADER_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        pl: '14px', // aligns with the nav icon column
      }}
    >
      <Typography
        variant="overline"
        sx={{
          color: 'text.secondary',
          fontWeight: 700,
          letterSpacing: '0.08em',
          lineHeight: 1,
        }}
      >
        {title}
      </Typography>
    </Box>
  )
}
