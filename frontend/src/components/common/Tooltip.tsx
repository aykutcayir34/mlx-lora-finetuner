import { useId, useState, type ReactNode } from 'react'

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  className?: string
}

export function Tooltip({ content, children, className = '' }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const id = useId()

  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      <span aria-describedby={visible ? id : undefined}>{children}</span>
      {visible && (
        <span
          id={id}
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface-raised px-2 py-1 text-xs text-text shadow-lg"
        >
          {content}
        </span>
      )}
    </span>
  )
}
