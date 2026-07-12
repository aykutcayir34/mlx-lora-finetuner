interface EmptyStateProps {
  message?: string
}

export function EmptyState({ message = 'Coming in Wave 2' }: EmptyStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border bg-surface/50 p-12 text-center">
      <p className="text-sm text-text-muted">{message}</p>
    </div>
  )
}
