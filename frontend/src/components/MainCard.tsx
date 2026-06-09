import React, { ReactNode, RefObject } from 'react'
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
  const customShadow = (theme as Theme & { customShadows?: { z1?: string } })
    .customShadows?.z1
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
          title={<Typography variant="h3">{title}</Typography>}
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
        border: border ? '1px solid' : 'none',
        borderRadius: 2,
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
