import type { SelectHTMLAttributes } from 'react'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[]
}

export function Select({ options, className = '', ...rest }: SelectProps) {
  return (
    <select
      className={`h-9 rounded-lg border border-border bg-surface px-3 text-sm text-text focus:outline-none focus:ring-1 focus:ring-accent ${className}`}
      {...rest}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
