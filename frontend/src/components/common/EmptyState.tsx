import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, description, icon, action, className = '' }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface/50 p-12 text-center ${className}`}
    >
      {icon && <div className="text-text-muted">{icon}</div>}
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {description && <p className="max-w-sm text-sm text-text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
