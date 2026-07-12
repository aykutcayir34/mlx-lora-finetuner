import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  title?: string
  className?: string
}

export function Card({ children, title, className = '' }: CardProps) {
  return (
    <div className={`rounded-xl border border-border bg-surface p-4 ${className}`}>
      {title && <h3 className="mb-3 text-sm font-semibold text-text">{title}</h3>}
      {children}
    </div>
  )
}
