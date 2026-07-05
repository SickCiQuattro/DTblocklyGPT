import { CSSObject, styled, Theme } from '@mui/material/styles'
import Drawer from '@mui/material/Drawer'

import { drawerWidth, LAYOUT } from 'utils/constants'

const COLLAPSED_WIDTH = 56

// Collapsed root reserves the rail width *plus* the gutter, so the floating
// paper stays a full 56px wide — NavItem's icon column + padding (28+6+8+16
// = 58px, see NavItem.tsx) needs that full width and clips/overflows the
// rounded card if the paper itself is shrunk instead. Open state doesn't
// have this problem (240-12=228px has plenty of room), so only closed
// differs: root grows by the gutter rather than paper shrinking by it.
export const RAIL_CLOSED_WIDTH = COLLAPSED_WIDTH + LAYOUT.gutter

// Every other animated panel in the shell (chat resize, Digital Twin slide,
// editor width when the Twin opens) moves on cubic-bezier(0.4,0,0.2,1) @
// 300ms. The rail used to move on MUI Drawer's default 'sharp' easing +
// enteringScreen/leavingScreen durations instead — a different curve/timing
// that read as inconsistent. Rail root, rail paper, and the AppBar (which
// must stay in lockstep with the rail) all share this one definition.
export const railTransition = (
  theme: Theme,
  property: string | string[],
): string =>
  theme.transitions.create(property, {
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    duration: 300,
  })

// The rail is a floating card, like the workspace panels — but the *root*
// Drawer element must keep reserving the full drawerWidth/RAIL_CLOSED_WIDTH in
// normal flow (AppBar/main content offsets read that reserved width), so only
// the fixed *paper* is inset + radius + shadow. Root and paper are
// intentionally different sizes; do not re-merge them.
const floatingPaperStyle = (theme: Theme, width: number): CSSObject => ({
  width,
  margin: `${LAYOUT.gutter}px 0 ${LAYOUT.gutter}px ${LAYOUT.gutter}px`,
  height: `calc(100vh - ${LAYOUT.gutter * 2}px)`,
  borderRadius: '16px',
  border: `1px solid ${theme.palette.divider}`,
  boxShadow: theme.customShadows.card,
  overflow: 'hidden', // clip header/footer squares to the rounded card
  transition: railTransition(theme, 'width'),
})

export const openedMixin = (theme: Theme): CSSObject => ({
  width: drawerWidth,
  transition: railTransition(theme, 'width'),
  overflowX: 'hidden',
})

export const closedMixin = (theme: Theme): CSSObject => ({
  width: RAIL_CLOSED_WIDTH,
  transition: railTransition(theme, 'width'),
  overflowX: 'hidden',
})

export const openedPaperMixin = (theme: Theme): CSSObject =>
  floatingPaperStyle(theme, drawerWidth - LAYOUT.gutter)

export const closedPaperMixin = (theme: Theme): CSSObject =>
  floatingPaperStyle(theme, COLLAPSED_WIDTH)

export const MiniDrawerStyled = styled(Drawer, {
  shouldForwardProp: (prop) => prop !== 'open',
})<{ open: boolean }>(({ theme, open }) => ({
  width: drawerWidth,
  flexShrink: 0,
  whiteSpace: 'nowrap',
  boxSizing: 'border-box',
  ...(open && {
    ...openedMixin(theme),
    '& .MuiDrawer-paper': openedPaperMixin(theme),
  }),
  ...(!open && {
    ...closedMixin(theme),
    '& .MuiDrawer-paper': closedPaperMixin(theme),
  }),
}))
