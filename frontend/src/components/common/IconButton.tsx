import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Spinner } from './Spinner'

export type IconButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant
  loading?: boolean
  'aria-label': string
  children: ReactNode
}

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  primary: 'bg-accent text-bg hover:bg-accent-strong',
  secondary: 'border border-border bg-surface-raised text-text hover:bg-surface',
  danger: 'border border-danger/30 bg-danger/15 text-danger hover:bg-danger/25',
  ghost: 'bg-transparent text-text-muted hover:bg-surface-raised hover:text-text',
}

export function IconButton({
  variant = 'ghost',
  loading = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : children}
    </button>
  )
}
