import { Link } from 'react-router-dom'
import type { RunSummary } from '../../api/types'
import { useRuns } from '../../api/queries/training'
import { StatusBadge } from '../common/Badge'
import { Card } from '../common/Card'
import { Table, type TableColumn } from '../common/Table'
import { formatRelativeTime } from './format'

const RECENT_RUNS_LIMIT = 5

const COLUMNS: TableColumn<RunSummary>[] = [
  { key: 'name', header: 'İsim', render: (run) => run.name },
  { key: 'status', header: 'Durum', render: (run) => <StatusBadge status={run.status} /> },
  {
    key: 'mode',
    header: 'Mod / Tip',
    render: (run) => `${run.config.train_mode} / ${run.config.train_type}`,
  },
  {
    key: 'loss',
    header: 'Son loss',
    render: (run) => (run.final_train_loss !== null ? run.final_train_loss.toFixed(3) : '—'),
  },
  {
    key: 'time',
    header: 'Zaman',
    render: (run) => formatRelativeTime(run.created_at),
  },
  {
    key: 'action',
    header: '',
    render: () => (
      <Link to="/train" className="text-accent hover:underline">
        Görüntüle
      </Link>
    ),
  },
]

export function RecentRunsList() {
  const { data } = useRuns(undefined, RECENT_RUNS_LIMIT, 0)
  const runs = data?.runs ?? []

  return (
    <Card title="Son eğitimler">
      <Table
        columns={COLUMNS}
        data={runs}
        rowKey={(run) => run.run_id}
        emptyMessage="Henüz eğitim yok"
      />
    </Card>
  )
}
