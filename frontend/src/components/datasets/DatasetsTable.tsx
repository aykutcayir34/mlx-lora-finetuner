import { useTranslation } from 'react-i18next'
import { Table, type TableColumn } from '../common/Table'
import { Button } from '../common/Button'
import { FormatBadge } from './FormatBadge'
import { SplitStatusChips } from './SplitStatusChips'
import type { DatasetInfo } from '../../api/types'

interface DatasetsTableProps {
  datasets: DatasetInfo[]
  selectedId: string | null
  onSelect: (id: string) => void
  onDelete: (dataset: DatasetInfo) => void
}

export function DatasetsTable({ datasets, selectedId, onSelect, onDelete }: DatasetsTableProps) {
  const { t } = useTranslation('datasets')
  const columns: TableColumn<DatasetInfo>[] = [
    {
      key: 'name',
      header: t('table.name'),
      render: (dataset) => (
        <button
          type="button"
          onClick={() => onSelect(dataset.dataset_id)}
          aria-pressed={selectedId === dataset.dataset_id}
          className={`text-left font-medium hover:text-accent ${
            selectedId === dataset.dataset_id ? 'text-accent' : 'text-text'
          }`}
        >
          {dataset.name}
        </button>
      ),
    },
    {
      key: 'format',
      header: t('table.format'),
      render: (dataset) => <FormatBadge format={dataset.format} />,
    },
    {
      key: 'rows',
      header: t('table.rows'),
      render: (dataset) => dataset.row_count.toLocaleString(),
    },
    {
      key: 'split',
      header: t('table.split'),
      render: (dataset) => <SplitStatusChips splits={dataset.splits} />,
    },
    {
      key: 'created',
      header: t('table.created'),
      render: (dataset) => new Date(dataset.created_at).toLocaleString(),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (dataset) => (
        <Button variant="danger" size="sm" onClick={() => onDelete(dataset)}>
          {t('common:actions.delete')}
        </Button>
      ),
    },
  ]

  return (
    <Table
      columns={columns}
      data={datasets}
      rowKey={(dataset) => dataset.dataset_id}
      emptyMessage={t('table.empty')}
    />
  )
}
