import { Theme } from '@mui/material'

import { Badge } from './Badge'
import { Button } from './Button'
import { ButtonBase } from './ButtonBase'
import { CardContent } from './CardContent'
import { Checkbox } from './Checkbox'
import { Chip } from './Chip'
import { Dialog } from './Dialog'
import { IconButton } from './IconButton'
import { InputLabel } from './InputLabel'
import { LinearProgress } from './LinearProgress'
import { Link } from './Link'
import { ListItemIcon } from './ListItemIcon'
import { OutlinedInput } from './OutlinedInput'
import { Tab } from './Tab'
import { TableCell } from './TableCell'
import { Tabs } from './Tabs'
import { Tooltip } from './Tooltip'
import { InputBase } from './InputBase'
import { Typography } from './Typography'
import { Accordion } from './Accordion'
import { CssBaseline } from './CssBaseline'

export const componentsOverrides = (theme: Theme) => {
  return {
    ...CssBaseline(theme),
    ...Button(theme),
    ...ButtonBase(theme),
    ...Badge(theme),
    ...CardContent(),
    ...Checkbox(theme),
    ...Chip(theme),
    ...Dialog(theme),
    ...IconButton(theme),
    ...InputBase(),
    ...InputLabel(theme),
    ...LinearProgress(),
    ...Link(),
    ...ListItemIcon(),
    ...OutlinedInput(theme),
    ...Tab(theme),
    ...TableCell(theme),
    ...Tabs(),
    ...Tooltip(theme),
    ...Typography(),
    ...Accordion(theme),
  }
}
