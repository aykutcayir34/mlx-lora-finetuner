// Small formatting helpers shared by the dashboard widgets.

import type { TFunction } from 'i18next'

export function formatGb(value: number): string {
  return `${value.toFixed(1)} GB`
}

export function formatRelativeTime(iso: string, t: TFunction<'dashboard'>): string {
  const then = new Date(iso).getTime()
  const diffSec = Math.round((Date.now() - then) / 1000)

  if (diffSec < 60) return t('time.justNow')

  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return t('time.minutesAgo', { minutes: diffMin })

  const diffHour = Math.round(diffMin / 60)
  if (diffHour < 24) return t('time.hoursAgo', { hours: diffHour })

  const diffDay = Math.round(diffHour / 24)
  return t('time.daysAgo', { days: diffDay })
}
