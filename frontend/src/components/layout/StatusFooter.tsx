import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useRun } from '../../api/queries/training'
import { useHealth, useSystemStats } from '../../api/queries/system'

export function StatusFooter() {
  const { t } = useTranslation('layout')
  const { data: health, isError: isHealthError } = useHealth()
  const { data: stats, isError: isStatsError } = useSystemStats()
  const activeRunId = stats?.active_run_id ?? undefined
  const { data: activeRun } = useRun(activeRunId)

  const isHealthy = !isHealthError && health?.status === 'ok'
  const healthDotClass = isHealthy ? 'bg-success' : 'bg-danger'
  const healthLabel = isHealthy ? t('health.healthy') : t('health.unreachable')

  const memoryLabel =
    !isStatsError && stats
      ? t('footer.memory', {
          used: stats.memory.used_gb.toFixed(1),
          total: stats.memory.total_gb.toFixed(1),
        })
      : t('footer.memoryUnknown')

  return (
    <footer className="flex h-9 items-center justify-between border-t border-border bg-surface px-4 text-xs text-text-muted">
      {activeRun ? (
        <Link to="/train" className="hover:text-text">
          {t('footer.activeRun', { id: activeRun.run_id, status: activeRun.status })}
        </Link>
      ) : (
        <span>{t('footer.noActiveJob')}</span>
      )}
      <div className="flex items-center gap-3">
        <span>{memoryLabel}</span>
        <div className="flex items-center gap-2" title={healthLabel}>
          <span
            data-testid="footer-health-dot"
            aria-label={healthLabel}
            className={`h-2 w-2 rounded-full ${healthDotClass}`}
          />
          <span>{healthLabel}</span>
        </div>
      </div>
    </footer>
  )
}
