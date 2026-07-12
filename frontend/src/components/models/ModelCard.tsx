import { Badge } from '../common/Badge'
import { Card } from '../common/Card'
import { IconButton } from '../common/IconButton'
import type { ModelInfo } from '../../api/types'
import { formatBytes } from './format'

interface ModelCardProps {
  model: ModelInfo
  onDelete: (model: ModelInfo) => void
  isDeleting?: boolean
}

export function ModelCard({ model, onDelete, isDeleting = false }: ModelCardProps) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-all text-sm font-semibold text-text">{model.model_id}</h3>
          <p className="mt-0.5 text-xs text-text-muted">{model.model_type}</p>
        </div>
        <IconButton
          aria-label={`Delete ${model.model_id}`}
          variant="danger"
          onClick={() => onDelete(model)}
          loading={isDeleting}
          className="shrink-0"
        >
          <TrashIcon />
        </IconButton>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-muted">
        <span>{formatBytes(model.size_bytes)}</span>
        {model.quantization && <Badge variant="info">{model.quantization.bits}-bit</Badge>}
        <span>{new Date(model.downloaded_at).toLocaleDateString()}</span>
      </div>
    </Card>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m-6.5 0 .6 9.4a1.5 1.5 0 0 0 1.5 1.4h4.8a1.5 1.5 0 0 0 1.5-1.4L14.5 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
