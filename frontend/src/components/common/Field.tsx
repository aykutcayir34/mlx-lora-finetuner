import type { ReactNode } from 'react'

interface FieldProps {
  label: string
  error?: string
  hint?: string
  children: ReactNode
  htmlFor?: string
  className?: string
}

export function Field({ label, error, hint, children, htmlFor, className = '' }: FieldProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-text">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-text-muted">{hint}</p>
      ) : null}
    </div>
  )
}
