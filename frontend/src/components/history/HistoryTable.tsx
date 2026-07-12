import { Table, type TableColumn } from '../common/Table'
import { StatusBadge } from '../common/Badge'
import type { RunSummary } from '../../api/types'

interface HistoryTableProps {
  runs: RunSummary[]
  selectedRunId: string | null
  onSelect: (runId: string) => void
}

function formatLoss(value: number | null): string {
  return value === null ? '—' : value.toFixed(4)
}

function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) return '—'
  const seconds = Math.max(
    0,
    Math.floor((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000),
  )
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

export function HistoryTable({ runs, selectedRunId, onSelect }: HistoryTableProps) {
  const columns: TableColumn<RunSummary>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (run) => (
        <button
          type="button"
          onClick={() => onSelect(run.run_id)}
          aria-pressed={selectedRunId === run.run_id}
          className={`text-left font-medium hover:text-accent ${
            selectedRunId === run.run_id ? 'text-accent' : 'text-text'
          }`}
        >
          {run.name}
        </button>
      ),
    },
    { key: 'status', header: 'Status', render: (run) => <StatusBadge status={run.status} /> },
    { key: 'model', header: 'Model', render: (run) => run.config.model_id },
    { key: 'dataset', header: 'Dataset', render: (run) => run.config.dataset_id },
    {
      key: 'mode',
      header: 'Mode / Type',
      render: (run) => `${run.config.train_mode} / ${run.config.train_type}`,
    },
    { key: 'train_loss', header: 'Train loss', render: (run) => formatLoss(run.final_train_loss) },
    { key: 'val_loss', header: 'Val loss', render: (run) => formatLoss(run.final_val_loss) },
    {
      key: 'created_at',
      header: 'Created',
      render: (run) => new Date(run.created_at).toLocaleString(),
    },
    {
      key: 'duration',
      header: 'Duration',
      render: (run) => formatDuration(run.started_at, run.finished_at),
    },
  ]

  return (
    <div data-testid="history-table">
      <Table
        columns={columns}
        data={runs}
        rowKey={(run) => run.run_id}
        emptyMessage="No runs found."
      />
    </div>
  )
}
