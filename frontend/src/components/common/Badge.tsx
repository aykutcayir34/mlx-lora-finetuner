import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { JobStatus } from '../../api/types'

export type BadgeVariant = 'neutral' | 'success' | 'danger' | 'warning' | 'info'

interface BadgeProps {
  children: ReactNode
  variant?: BadgeVariant
  className?: string
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: 'border-border bg-surface-raised text-text-muted',
  success: 'border-success/30 bg-success/15 text-success',
  danger: 'border-danger/30 bg-danger/15 text-danger',
  warning: 'border-amber-400/30 bg-amber-400/15 text-amber-400',
  info: 'border-accent/30 bg-accent/15 text-accent',
}

export function Badge({ children, variant = 'neutral', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </span>
  )
}

interface StatusConfig {
  variant: BadgeVariant
  pulse?: boolean
}

const STATUS_CONFIG: Record<JobStatus, StatusConfig> = {
  queued: { variant: 'neutral' },
  running: { variant: 'info', pulse: true },
  completed: { variant: 'success' },
  failed: { variant: 'danger' },
  cancelled: { variant: 'neutral' },
}

interface StatusBadgeProps {
  status: JobStatus
  className?: string
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const { t } = useTranslation('common')
  const config = STATUS_CONFIG[status]
  return (
    <Badge variant={config.variant} className={className}>
      {config.pulse && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
      {t(`status.${status}`)}
    </Badge>
  )
}
