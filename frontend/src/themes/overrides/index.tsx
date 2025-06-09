import { Theme } from '@mui/material'

import { Badge } from './Badge'
import { Button } from './Button'
import { CardContent } from './CardContent'
import { Checkbox } from './Checkbox'
import { Chip } from './Chip'
import { IconButton } from './IconButton'
import { InputLabel } from './InputLabel'
import { LinearProgress } from './LinearProgress'
import { Link } from './Link'
import { ListItemIcon } from './ListItemIcon'
import { OutlinedInput } from './OutlinedInput'
import { Tab } from './Tab'
import { TableCell } from './TableCell'
import { Tabs } from './Tabs'
import { InputBase } from './InputBase'
import { Typography } from './Typography'

export const componentsOverrides = (theme: Theme) => {
  return {
    ...Button(theme),
    ...Badge(theme),
    ...CardContent(),
    ...Checkbox(theme),
    ...Chip(theme),
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
    ...Typography(),
  }
}
