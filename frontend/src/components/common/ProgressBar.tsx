interface ProgressBarProps {
  value: number
  indeterminate?: boolean
  label?: string
  className?: string
}

export function ProgressBar({
  value,
  indeterminate = false,
  label,
  className = '',
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value))

  return (
    <div className={className}>
      {label && (
        <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
          <span>{label}</span>
          {!indeterminate && <span>{Math.round(clamped)}%</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-raised"
      >
        {indeterminate ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
        ) : (
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${clamped}%` }}
          />
        )}
      </div>
    </div>
  )
}
