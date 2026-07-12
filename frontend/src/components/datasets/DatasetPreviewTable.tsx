import { useState } from 'react'
import { Button } from '../common/Button'
import { EmptyState } from '../common/EmptyState'
import { Select } from '../common/Select'
import { Spinner } from '../common/Spinner'
import { Table, type TableColumn } from '../common/Table'
import { useDatasetPreview } from '../../api/queries/datasets'
import type { DatasetFormat, DatasetSplits, PreviewSplit } from '../../api/types'

interface DatasetPreviewTableProps {
  datasetId: string
  format: DatasetFormat
  splits: DatasetSplits | null
}

const PAGE_SIZE = 20

const SPLIT_LABELS: Record<PreviewSplit, string> = {
  raw: 'Raw',
  train: 'Train',
  valid: 'Valid',
  test: 'Test',
}

export function DatasetPreviewTable({ datasetId, format, splits }: DatasetPreviewTableProps) {
  const [split, setSplit] = useState<PreviewSplit>('raw')
  const [page, setPage] = useState(1)
  const preview = useDatasetPreview(datasetId, split, page, PAGE_SIZE)

  const availableSplits: PreviewSplit[] = splits ? ['raw', 'train', 'valid', 'test'] : ['raw']

  function handleSplitChange(next: PreviewSplit) {
    setSplit(next)
    setPage(1)
  }

  const totalPages = preview.data ? Math.max(1, Math.ceil(preview.data.total_rows / PAGE_SIZE)) : 1

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Select
          aria-label="Preview split"
          value={split}
          onChange={(event) => handleSplitChange(event.target.value as PreviewSplit)}
          options={availableSplits.map((value) => ({ value, label: SPLIT_LABELS[value] }))}
        />
        {preview.data && (
          <p className="text-xs text-text-muted">
            {preview.data.total_rows} rows &middot; page {preview.data.page} / {totalPages}
          </p>
        )}
      </div>

      {preview.isLoading && <Spinner />}
      {preview.isError && <p className="text-sm text-danger">Failed to load preview.</p>}
      {preview.data && preview.data.rows.length === 0 && (
        <EmptyState title="No rows" description="This split has no rows yet." />
      )}
      {preview.data && preview.data.rows.length > 0 && <PreviewRows format={format} rows={preview.data.rows} />}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          disabled={page <= 1}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setPage((current) => current + 1)}
          disabled={!preview.data || page >= totalPages}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

type PreviewRow = Record<string, unknown> & { __previewIndex: number }

function withIndex(rows: Record<string, unknown>[]): PreviewRow[] {
  return rows.map((row, index) => ({ ...row, __previewIndex: index }))
}

function textOf(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

interface PreviewRowsProps {
  format: DatasetFormat
  rows: Record<string, unknown>[]
}

function PreviewRows({ format, rows }: PreviewRowsProps) {
  switch (format) {
    case 'chat':
      return <ChatPreview rows={rows} />
    case 'completions': {
      const columns: TableColumn<PreviewRow>[] = [
        { key: 'prompt', header: 'Prompt', render: (row) => textOf(row.prompt) },
        { key: 'completion', header: 'Completion', render: (row) => textOf(row.completion) },
      ]
      return <Table columns={columns} data={withIndex(rows)} rowKey={(row) => String(row.__previewIndex)} />
    }
    case 'text': {
      const columns: TableColumn<PreviewRow>[] = [{ key: 'text', header: 'Text', render: (row) => textOf(row.text) }]
      return <Table columns={columns} data={withIndex(rows)} rowKey={(row) => String(row.__previewIndex)} />
    }
    case 'dpo':
    case 'orpo': {
      const hasScore = rows.some((row) => typeof row.preference_score === 'number')
      const columns: TableColumn<PreviewRow>[] = [
        { key: 'prompt', header: 'Prompt', render: (row) => textOf(row.prompt) },
        { key: 'chosen', header: 'Chosen', render: (row) => textOf(row.chosen) },
        { key: 'rejected', header: 'Rejected', render: (row) => textOf(row.rejected) },
      ]
      if (hasScore) {
        columns.push({ key: 'score', header: 'Score', render: (row) => textOf(row.preference_score) })
      }
      return <Table columns={columns} data={withIndex(rows)} rowKey={(row) => String(row.__previewIndex)} />
    }
    case 'grpo': {
      const columns: TableColumn<PreviewRow>[] = [
        { key: 'prompt', header: 'Prompt', render: (row) => textOf(row.prompt) },
        { key: 'answer', header: 'Answer', render: (row) => textOf(row.answer) },
        { key: 'system', header: 'System', render: (row) => (row.system ? textOf(row.system) : '—') },
      ]
      return <Table columns={columns} data={withIndex(rows)} rowKey={(row) => String(row.__previewIndex)} />
    }
  }
}

interface ChatMessageLike {
  role: string
  content: string
}

function ChatPreview({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <div className="flex flex-col gap-4">
      {withIndex(rows).map((row) => {
        const messages = Array.isArray(row.messages) ? (row.messages as ChatMessageLike[]) : []
        return (
          <div key={row.__previewIndex} className="rounded-lg border border-border p-3">
            <div className="flex flex-col gap-2">
              {messages.map((message, messageIndex) => (
                <div key={messageIndex} className="flex gap-2 text-sm">
                  <span className="w-20 shrink-0 font-semibold uppercase text-text-muted">{message.role}</span>
                  <span className="text-text">{message.content}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
