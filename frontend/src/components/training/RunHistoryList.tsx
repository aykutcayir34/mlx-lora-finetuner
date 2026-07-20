import { useTranslation } from 'react-i18next'
import { useRuns } from '../../api/queries/training'
import { Card } from '../common/Card'
import { Button } from '../common/Button'
import { StatusBadge } from '../common/Badge'

interface RunHistoryListProps {
  selectedRunId: string | null
  onSelect: (runId: string) => void
  onNewRun: () => void
}

export function RunHistoryList({ selectedRunId, onSelect, onNewRun }: RunHistoryListProps) {
  const { t } = useTranslation('train')
  const runsQuery = useRuns(undefined, 20, 0)
  const runs = runsQuery.data?.runs ?? []

  return (
    <Card title={t('runList.title')} className="flex w-72 flex-shrink-0 flex-col gap-3">
      <Button size="sm" onClick={onNewRun} className="w-full">
        {t('runList.newRun')}
      </Button>
      <div className="flex flex-col gap-1.5">
        {runs.length === 0 ? (
          <p className="text-sm text-text-muted">{t('runList.empty')}</p>
        ) : (
          runs.map((run) => (
            <button
              key={run.run_id}
              type="button"
              onClick={() => onSelect(run.run_id)}
              className={`flex flex-col gap-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                run.run_id === selectedRunId
                  ? 'border-accent bg-accent/10'
                  : 'border-border bg-surface-raised hover:bg-surface'
              }`}
            >
              <span className="font-medium text-text">{run.name}</span>
              <StatusBadge status={run.status} />
            </button>
          ))
        )}
      </div>
    </Card>
  )
}
