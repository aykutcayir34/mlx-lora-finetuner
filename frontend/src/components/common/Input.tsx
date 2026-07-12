import type { InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

export function Input({ error = false, className = '', ...rest }: InputProps) {
  return (
    <input
      className={`h-9 rounded-lg border bg-surface px-3 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent ${
        error ? 'border-danger' : 'border-border'
      } ${className}`}
      {...rest}
    />
  )
}
