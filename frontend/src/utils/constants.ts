// ─── Layout constants ────────────────────────────────────────────────────────
// Used as CSS custom properties (--layout-appbar-height, --layout-statusbar-height)
// to avoid magic numbers in position:fixed panels (DigitalTwinPanel, BottomPanel).
// Update here only — CSS vars propagate automatically.
export const LAYOUT = {
  appBarHeight: 56, // AppBar height (px)
  statusBarHeight: 40, // StatusBar footer height (px)
  gutter: 12, // Floating-shell margin: rail/workspace/twin inset from viewport edges (px)
} as const

// ─── Drawer ──────────────────────────────────────────────────────────────────
export const drawerWidth = 220

// ─── Navigation ──────────────────────────────────────────────────────────────
export const defaultOpenItem = ''
export const defaultPath = '/'

// ─── Environment ─────────────────────────────────────────────────────────────
enum ENV_TYPE {
  DEVELOPMENT = 'development',
  PRODUCTION = 'production',
}
export const isDevelopment = import.meta.env.MODE === ENV_TYPE.DEVELOPMENT

// ─── User roles ──────────────────────────────────────────────────────────────
export enum USER_GROUP {
  MANAGER = 'Manager',
  OPERATOR = 'Operator',
}

// ─── Table pagination ────────────────────────────────────────────────────────
export const defaultPageSizeSelection = 25
export const defaultCurrentPage = 1
export const defaultPageSizeOptions = [10, 25, 40]

// Compatibility shim for AntD list pages pending migration — plain object, no antd type
export const defaultPaginationConfig = {
  pageSizeOptions: defaultPageSizeOptions,
  showSizeChanger: true,
  hideOnSinglePage: true,
}

// ─── Autocomplete ────────────────────────────────────────────────────────────
export const timerTimeoutAutocomplete = 500
export const minCharsAutocomplete = 1
