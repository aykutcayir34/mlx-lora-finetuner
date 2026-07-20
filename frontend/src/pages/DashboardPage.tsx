import { useTranslation } from 'react-i18next'
import { useModels } from '../api/queries/models'
import { useSystemStats } from '../api/queries/system'
import { useRuns } from '../api/queries/training'
import { ActiveRunCard } from '../components/dashboard/ActiveRunCard'
import { OnboardingGuide } from '../components/dashboard/OnboardingGuide'
import { QuickCounts } from '../components/dashboard/QuickCounts'
import { RecentRunsList } from '../components/dashboard/RecentRunsList'
import { SystemStatsPanel } from '../components/dashboard/SystemStatsPanel'
import { PageShell } from '../components/layout/PageShell'

const RECENT_RUNS_LIMIT = 5

export function DashboardPage() {
  const { t } = useTranslation('dashboard')
  const { data: stats } = useSystemStats()
  const { data: models } = useModels()
  const { data: runsData } = useRuns(undefined, RECENT_RUNS_LIMIT, 0)

  const showOnboarding = models?.length === 0 && runsData?.total === 0

  return (
    <PageShell title={t('title')} description={t('description')}>
      <SystemStatsPanel />
      {showOnboarding ? (
        <OnboardingGuide />
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <ActiveRunCard activeRunId={stats?.active_run_id ?? null} />
            <QuickCounts />
          </div>
          <RecentRunsList />
        </>
      )}
    </PageShell>
  )
}
