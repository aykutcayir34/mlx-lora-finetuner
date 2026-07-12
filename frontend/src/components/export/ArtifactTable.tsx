import { useState } from 'react'
import { useArtifacts } from '../../api/queries/export'
import type { ExportArtifact, ExportArtifactKind } from '../../api/types'
import { Card } from '../common/Card'
import { Table, type TableColumn } from '../common/Table'
import { Badge, type BadgeVariant } from '../common/Badge'
import { EmptyState } from '../common/EmptyState'
import { formatBytes } from './format'

const KIND_VARIANT: Record<ExportArtifactKind, BadgeVariant> = {
  fused: 'info',
  gguf: 'success',
  modelfile: 'neutral',
}

function CopyPath({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(path)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }
    } catch {
      // Clipboard unavailable or permission denied — nothing further to do.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="max-w-xs truncate font-mono text-xs text-text hover:text-accent"
      title={path}
    >
      {copied ? 'Copied' : path}
    </button>
  )
}

const COLUMNS: TableColumn<ExportArtifact>[] = [
  {
    key: 'kind',
    header: 'Kind',
    render: (row) => <Badge variant={KIND_VARIANT[row.kind]}>{row.kind}</Badge>,
  },
  { key: 'path', header: 'Path', render: (row) => <CopyPath path={row.path} /> },
  { key: 'size', header: 'Size', render: (row) => formatBytes(row.size_bytes) },
  { key: 'source_run', header: 'Source run', render: (row) => row.source_run_id ?? '—' },
  { key: 'created', header: 'Created', render: (row) => row.created_at },
]

export function ArtifactTable() {
  const artifacts = useArtifacts()
  const rows = artifacts.data?.artifacts ?? []

  return (
    <Card title="Artifacts" className="mt-6">
      {rows.length === 0 ? (
        <EmptyState
          title="No artifacts yet"
          description="Fuse an adapter, convert to GGUF or generate a Modelfile to see it here."
        />
      ) : (
        <Table columns={COLUMNS} data={rows} rowKey={(row) => row.id} />
      )}
    </Card>
  )
}
