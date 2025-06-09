import React from 'react'
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  VideoCameraFilled,
} from '@ant-design/icons'
import { Palette } from 'themes/palette'

const themePalette = Palette('light')

export const iconMap = {
  deleteCircle: (
    <CloseCircleOutlined
      style={{ color: themePalette.palette.error.main, fontSize: '2em' }}
    />
  ),
  successData: (
    <CheckCircleOutlined
      style={{ color: themePalette.palette.success.main, fontSize: '2em' }}
    />
  ),
  partialData: (
    <ClockCircleOutlined
      style={{ color: themePalette.palette.warning.main, fontSize: '2em' }}
    />
  ),
  successDataSmall: (
    <CheckCircleOutlined style={{ color: themePalette.palette.success.main }} />
  ),
  partialDataSmall: (
    <ClockCircleOutlined style={{ color: themePalette.palette.warning.main }} />
  ),
  webcamOn: (
    <VideoCameraFilled
      style={{ color: themePalette.palette.primary.main, fontSize: '2em' }}
    />
  ),
  webcamOff: (
    <VideoCameraFilled
      style={{ color: themePalette.palette.secondary.light, fontSize: '2em' }}
    />
  ),
  deleteTrash: (
    <DeleteOutlined
      style={{ color: themePalette.palette.error.main, fontSize: '2em' }}
    />
  ),
}
