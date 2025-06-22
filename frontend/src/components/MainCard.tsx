import React, { ReactNode, RefObject } from 'react'
import { useTheme } from '@mui/material/styles'
import {
  Button,
  Card,
  CardActionArea,
  CardContent,
  CardHeader,
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
  sx?: any
  title?: string
  subtitle?: string
  content?: boolean
  children?: ReactNode | ReactNode[]
  contentSX?: any
  backFunction?: any
  onClick?: any
}

const defaultSx = {}
const defaultContentSX = {}

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
  backFunction = null,
  onClick = null,
}: MainCardProps) => {
  const theme = useTheme()
  const boxShadowThemed =
    theme.palette.mode === 'dark' ? boxShadow || true : boxShadow

  const cardContent = (
    <>
      {/* card header and action */}
      {title && (
        <CardHeader
          sx={headerSX}
          titleTypographyProps={{ variant: 'h3' }}
          title={title}
          subheader={subtitle}
          action={
            backFunction && (
              <Button onClick={() => backFunction()}>Indietro</Button>
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
      ref={ref as RefObject<HTMLDivElement>}
      sx={{
        ...sx,
        border: border ? '1px solid' : 'none',
        borderRadius: 2,
        borderColor:
          theme.palette.mode === 'dark'
            ? theme.palette.divider
            : (theme.palette.grey as any).A800,
        boxShadow:
          boxShadowThemed && (!border || theme.palette.mode === 'dark')
            ? shadow || (theme as any).customShadows.z1
            : 'inherit',
        ':hover': {
          boxShadow: boxShadowThemed
            ? shadow || (theme as any).customShadows.z1
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
