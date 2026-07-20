import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useRun, useRunMetrics } from '../../api/queries/training'
import { LossChart } from '../charts/LossChart'
import { StatusBadge } from '../common/Badge'
import { Card } from '../common/Card'

const CTA_LINK_CLASSES =
  'inline-flex h-10 w-fit items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-bg transition-colors hover:bg-accent-strong'

interface ActiveRunCardProps {
  activeRunId: string | null
}

export function ActiveRunCard({ activeRunId }: ActiveRunCardProps) {
  const { t } = useTranslation('dashboard')
  if (!activeRunId) {
    return (
      <Card title={t('activeRun.noneTitle')}>
        <p className="mb-3 text-sm text-text-muted">{t('activeRun.noneDescription')}</p>
        <Link to="/train" className={CTA_LINK_CLASSES}>
          {t('activeRun.startCta')}
        </Link>
      </Card>
    )
  }

  return <ActiveRunCardContent activeRunId={activeRunId} />
}

function ActiveRunCardContent({ activeRunId }: { activeRunId: string }) {
  const { t } = useTranslation('dashboard')
  const { data: run } = useRun(activeRunId)
  const { data: metricsData } = useRunMetrics(activeRunId, 0)

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text">{run?.name ?? activeRunId}</h3>
          {run && <StatusBadge status={run.status} className="mt-1" />}
        </div>
        <Link to="/train" className="text-sm text-accent hover:underline">
          {t('activeRun.goToMonitor')}
        </Link>
      </div>
      <LossChart data={metricsData?.metrics ?? []} />
    </Card>
  )
}
