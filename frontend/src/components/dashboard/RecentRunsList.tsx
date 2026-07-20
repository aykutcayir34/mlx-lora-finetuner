import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { RunSummary } from '../../api/types'
import { useRuns } from '../../api/queries/training'
import { StatusBadge } from '../common/Badge'
import { Card } from '../common/Card'
import { Table, type TableColumn } from '../common/Table'
import { formatRelativeTime } from './format'

const RECENT_RUNS_LIMIT = 5

export function RecentRunsList() {
  const { t } = useTranslation('dashboard')
  const { data } = useRuns(undefined, RECENT_RUNS_LIMIT, 0)
  const runs = data?.runs ?? []

  const columns: TableColumn<RunSummary>[] = [
    { key: 'name', header: t('recentRuns.columns.name'), render: (run) => run.name },
    {
      key: 'status',
      header: t('recentRuns.columns.status'),
      render: (run) => <StatusBadge status={run.status} />,
    },
    {
      key: 'mode',
      header: t('recentRuns.columns.modeType'),
      render: (run) => `${run.config.train_mode} / ${run.config.train_type}`,
    },
    {
      key: 'loss',
      header: t('recentRuns.columns.finalLoss'),
      render: (run) => (run.final_train_loss !== null ? run.final_train_loss.toFixed(3) : '—'),
    },
    {
      key: 'time',
      header: t('recentRuns.columns.time'),
      render: (run) => formatRelativeTime(run.created_at, t),
    },
    {
      key: 'action',
      header: '',
      render: () => (
        <Link to="/train" className="text-accent hover:underline">
          {t('recentRuns.view')}
        </Link>
      ),
    },
  ]

  return (
    <Card title={t('recentRuns.title')}>
      <Table
        columns={columns}
        data={runs}
        rowKey={(run) => run.run_id}
        emptyMessage={t('recentRuns.empty')}
      />
    </Card>
  )
}
