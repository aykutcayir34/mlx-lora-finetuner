import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../common/Button'
import { Tabs } from '../common/Tabs'
import { DatasetPreviewTable } from './DatasetPreviewTable'
import { SplitDialog } from './SplitDialog'
import { ValidationReportView } from './ValidationReportView'
import type { DatasetInfo } from '../../api/types'

interface DatasetDetailProps {
  dataset: DatasetInfo
}

type DetailTab = 'preview' | 'validate'

export function DatasetDetail({ dataset }: DatasetDetailProps) {
  const { t } = useTranslation('datasets')
  const [tab, setTab] = useState<DetailTab>('preview')
  const [splitOpen, setSplitOpen] = useState(false)

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text">{dataset.name}</h3>
          <p className="text-xs text-text-muted">{dataset.dataset_id}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setSplitOpen(true)}>
          {t('detail.splitButton')}
        </Button>
      </div>

      <Tabs
        tabs={[
          { id: 'preview', label: t('detail.previewTab') },
          { id: 'validate', label: t('detail.validateTab') },
        ]}
        activeId={tab}
        onChange={(id) => setTab(id as DetailTab)}
      >
        {tab === 'preview' ? (
          <DatasetPreviewTable datasetId={dataset.dataset_id} format={dataset.format} splits={dataset.splits} />
        ) : (
          <ValidationReportView datasetId={dataset.dataset_id} />
        )}
      </Tabs>

      <SplitDialog open={splitOpen} datasetId={dataset.dataset_id} onClose={() => setSplitOpen(false)} />
    </div>
  )
}
