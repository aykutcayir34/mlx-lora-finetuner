import { Badge, type BadgeVariant } from '../common/Badge'
import type { DatasetFormat } from '../../api/types'

interface FormatMeta {
  variant: BadgeVariant
  color: string
  label: string
}

// Each format gets its own dot color (inline style, so it doesn't depend on
// Tailwind's utility-ordering cascade) layered on top of the closest Badge
// variant tint, giving six visually distinct combinations.
const FORMAT_META: Record<DatasetFormat, FormatMeta> = {
  chat: { variant: 'info', color: '#38bdf8', label: 'Chat' },
  completions: { variant: 'success', color: '#4ade80', label: 'Completions' },
  text: { variant: 'neutral', color: '#8b8d98', label: 'Text' },
  dpo: { variant: 'warning', color: '#fbbf24', label: 'DPO' },
  orpo: { variant: 'danger', color: '#f87171', label: 'ORPO' },
  grpo: { variant: 'info', color: '#a78bfa', label: 'GRPO' },
}

interface FormatBadgeProps {
  format: DatasetFormat
  className?: string
}

export function FormatBadge({ format, className = '' }: FormatBadgeProps) {
  const meta = FORMAT_META[format]
  return (
    <Badge variant={meta.variant} className={className}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.label}
    </Badge>
  )
}
