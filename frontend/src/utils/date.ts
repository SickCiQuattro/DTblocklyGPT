import dayjs, { Dayjs } from 'dayjs'

const backEndDateFormat = 'YYYY-MM-DD'
const frontEndDateFormat = 'DD/MM/YYYY'
const frontEndDateTimeFormat = 'DD/MM/YYYY HH:mm:ss'
const frontEndTimeFormat = 'HH:mm'
export const dateRegex = /^\d{4}-\d{2}-\d{2}$/

const formatDate = (value: string | Dayjs | null, format: string) => {
  if (!value) return null
  return dayjs(value).format(format)
}

export const formatDateBackend = (
  value: Dayjs | string | null,
): string | null => formatDate(value, backEndDateFormat)

export const formatDateFrontend = (value: string | null): string | null =>
  formatDate(value, frontEndDateFormat)

export const formatDateTimeFrontend = (value: string | null): string | null =>
  formatDate(value, frontEndDateTimeFormat)

export const formatTimeFrontend = (value: string | null): string | null =>
  formatDate(value, frontEndTimeFormat)
