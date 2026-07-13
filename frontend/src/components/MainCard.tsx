import React, { ReactNode } from 'react'
import { SxProps, Theme, useTheme } from '@mui/material/styles'
import {
  Button,
  Card,
  CardActionArea,
  CardContent,
  CardHeader,
  Typography,
} from '@mui/material'

const headerSX = {
  p: 2.5,
  '& .MuiCardHeader-action': { m: '0px auto', alignSelf: 'center' },
}

interface MainCardProps {
  ref?: React.Ref<HTMLDivElement>
  border?: boolean
  boxShadow?: boolean
  elevation?: number
  shadow?: string
  sx?: SxProps<Theme>
  title?: string
  subtitle?: string
  content?: boolean
  children?: ReactNode | ReactNode[]
  contentSX?: SxProps<Theme>
  backFunction?: () => void
  backTitle?: string
  customElement?: ReactNode
  onClick?: () => void
}

const defaultSx: SxProps<Theme> = {}
const defaultContentSX: SxProps<Theme> = {}

export const MainCard = ({
  ref,
  border = true,
  boxShadow = false,
  elevation = 0,
  shadow = '',
  sx = defaultSx,
  title = '',
  subtitle = '',
  content = true,
  children = null,
  contentSX = defaultContentSX,
  backFunction,
  backTitle = 'Back',
  customElement = null,
  onClick,
}: MainCardProps) => {
  const theme = useTheme()
  const customShadow = theme.customShadows?.card
  const lightBorderColor = (
    theme.palette.grey as typeof theme.palette.grey & { A800?: string }
  ).A800
  const boxShadowThemed =
    theme.palette.mode === 'dark' ? boxShadow || true : boxShadow

  const cardContent = (
    <>
      {/* card header and action */}
      {title && (
        <CardHeader
          sx={headerSX}
          title={
            <Typography variant="h3" component="h1">
              {title}
            </Typography>
          }
          subheader={subtitle}
          action={
            (backFunction || customElement) && (
              <div
                style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}
              >
                {customElement}
                {backFunction && (
                  <Button onClick={() => backFunction()}>{backTitle}</Button>
                )}
              </div>
            )
          }
        />
      )}

      {/* card content */}
      {content && <CardContent sx={contentSX}>{children}</CardContent>}
      {!content && children}
    </>
  )

  return (
    <Card
      elevation={elevation}
      ref={ref}
      sx={{
        ...sx,
        // MainLayout wraps every page in a flex column with overflow:auto so
        // long pages scroll — but Card's own overflow:hidden (MUI default,
        // for rounded-corner clipping) gives it an automatic min-height of 0
        // as a flex item, so with the default flexShrink:1 it gets squeezed
        // to the viewport's height instead of scrolling, silently clipping
        // content. flexShrink:0 keeps it at its natural content height so
        // the ancestor's overflow:auto can do its job.
        flexShrink: 0,
        border: border ? '1px solid' : 'none',
        borderRadius: 1, // × shape.borderRadius (8) = 8px
        borderColor:
          theme.palette.mode === 'dark'
            ? theme.palette.divider
            : lightBorderColor || theme.palette.divider,
        boxShadow:
          boxShadowThemed && (!border || theme.palette.mode === 'dark')
            ? shadow || customShadow || theme.shadows[1]
            : 'inherit',
        ':hover': {
          boxShadow: boxShadowThemed
            ? shadow || customShadow || theme.shadows[1]
            : 'inherit',
        },
        '& pre': {
          m: 0,
          p: '16px !important',
          fontFamily: theme.typography.fontFamily,
          fontSize: '0.75rem',
        },
      }}
    >
      {onClick ? (
        <CardActionArea onClick={onClick}>{cardContent}</CardActionArea>
      ) : (
        cardContent
      )}
    </Card>
  )
}

MainCard.displayName = 'MainCard'
