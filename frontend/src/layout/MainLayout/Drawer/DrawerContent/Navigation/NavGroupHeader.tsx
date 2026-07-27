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
  if (!drawerOpen) {
    // Collapsed rail: draw a short hairline so adjacent icon-only groups
    // still read as separate regions (Gestalt: common region) — there's no
    // label at this width for any group, titled or not.
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
        <Divider sx={{ width: 24, borderColor: 'divider' }} />
      </Box>
    )
  }

  if (!title) {
    // Expanded, single-item group with no heading: reserve the same height
    // (so toggling the rail never shifts items vertically) but no divider —
    // unlike the collapsed rail, there's nothing here for it to separate.
    return <Box aria-hidden sx={{ height: NAV_GROUP_HEADER_HEIGHT }} />
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
