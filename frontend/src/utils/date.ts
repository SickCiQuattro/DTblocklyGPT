import dayjs, { Dayjs } from 'dayjs'

const backEndDateFormat = 'YYYY-MM-DD'
const frontEndDateFormat = 'DD/MM/YYYY'
const frontEndDateTimeFormat = 'DD/MM/YYYY HH:mm:ss'
const frontEndDateTimeShortFormat = 'DD/MM/YYYY HH:mm'
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

export const formatDateTimeShortFrontend = (
  value: string | null,
): string | null => formatDate(value, frontEndDateTimeShortFormat)

export const formatTimeFrontend = (value: string | null): string | null =>
  formatDate(value, frontEndTimeFormat)

/**
 * How long ago, in words, for a list an operator scans.
 *
 * A card grid sorted by date needs its order to be readable at a glance, and
 * `05/09/2026 17:57` is not: day and month have to be parsed and compared
 * before the sort even becomes visible. "2 hours ago" carries the ordering in
 * the phrase itself, and drops six characters of noise from every card.
 *
 * Falls back to the absolute date past a week, where "37 days ago" stops being
 * easier to read than the date it replaces. The absolute value is still shown
 * in full on hover — see the card's title attribute — so nothing is lost for
 * anyone who needs the exact minute.
 */
export const formatRelativeFrontend = (value: string | null): string | null => {
  if (!value) return null
  const then = dayjs(value)
  if (!then.isValid()) return null

  const minutes = dayjs().diff(then, 'minute')
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`

  return then.format(frontEndDateFormat)
}
