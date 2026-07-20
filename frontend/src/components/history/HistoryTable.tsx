import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
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

function formatDuration(
  startedAt: string | null,
  finishedAt: string | null,
  t: TFunction,
): string {
  if (!startedAt || !finishedAt) return '—'
  const seconds = Math.max(
    0,
    Math.floor((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000),
  )
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return t('history:duration.hm', { h: hours, m: minutes % 60 })
  if (minutes > 0) return t('history:duration.ms', { m: minutes, s: seconds % 60 })
  return t('history:duration.s', { s: seconds })
}

export function HistoryTable({ runs, selectedRunId, onSelect }: HistoryTableProps) {
  const { t } = useTranslation('history')
  const columns: TableColumn<RunSummary>[] = [
    {
      key: 'name',
      header: t('table.name'),
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
    { key: 'status', header: t('table.status'), render: (run) => <StatusBadge status={run.status} /> },
    { key: 'model', header: t('table.model'), render: (run) => run.config.model_id },
    { key: 'dataset', header: t('table.dataset'), render: (run) => run.config.dataset_id },
    {
      key: 'mode',
      header: t('table.modeType'),
      render: (run) => `${run.config.train_mode} / ${run.config.train_type}`,
    },
    { key: 'train_loss', header: t('table.trainLoss'), render: (run) => formatLoss(run.final_train_loss) },
    { key: 'val_loss', header: t('table.valLoss'), render: (run) => formatLoss(run.final_val_loss) },
    {
      key: 'created_at',
      header: t('table.created'),
      render: (run) => new Date(run.created_at).toLocaleString(),
    },
    {
      key: 'duration',
      header: t('table.duration'),
      render: (run) => formatDuration(run.started_at, run.finished_at, t),
    },
  ]

  return (
    <div data-testid="history-table">
      <Table
        columns={columns}
        data={runs}
        rowKey={(run) => run.run_id}
        emptyMessage={t('table.empty')}
      />
    </div>
  )
}
