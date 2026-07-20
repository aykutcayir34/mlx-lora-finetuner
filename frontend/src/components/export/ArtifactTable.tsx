import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('common')
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
      {copied ? t('actions.copied') : path}
    </button>
  )
}

export function ArtifactTable() {
  const { t } = useTranslation('export')
  const artifacts = useArtifacts()
  const rows = artifacts.data?.artifacts ?? []

  const columns: TableColumn<ExportArtifact>[] = [
    {
      key: 'kind',
      header: t('artifacts.columns.kind'),
      render: (row) => <Badge variant={KIND_VARIANT[row.kind]}>{row.kind}</Badge>,
    },
    { key: 'path', header: t('artifacts.columns.path'), render: (row) => <CopyPath path={row.path} /> },
    { key: 'size', header: t('artifacts.columns.size'), render: (row) => formatBytes(row.size_bytes) },
    {
      key: 'source_run',
      header: t('artifacts.columns.sourceRun'),
      render: (row) => row.source_run_id ?? '—',
    },
    { key: 'created', header: t('artifacts.columns.created'), render: (row) => row.created_at },
  ]

  return (
    <Card title={t('artifacts.title')} className="mt-6">
      {rows.length === 0 ? (
        <EmptyState
          title={t('artifacts.emptyTitle')}
          description={t('artifacts.emptyDescription')}
        />
      ) : (
        <Table columns={columns} data={rows} rowKey={(row) => row.id} />
      )}
    </Card>
  )
}
