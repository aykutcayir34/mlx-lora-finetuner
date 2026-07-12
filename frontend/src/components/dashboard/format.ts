// Small formatting helpers shared by the dashboard widgets.

export function formatGb(value: number): string {
  return `${value.toFixed(1)} GB`
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const diffSec = Math.round((Date.now() - then) / 1000)

  if (diffSec < 60) return 'az önce'

  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin} dk önce`

  const diffHour = Math.round(diffMin / 60)
  if (diffHour < 24) return `${diffHour} sa önce`

  const diffDay = Math.round(diffHour / 24)
  return `${diffDay} gün önce`
}
