import { useTranslation } from 'react-i18next'
import { useHealth, useSystemStats } from '../../api/queries/system'
import { Badge } from '../common/Badge'
import { Card } from '../common/Card'
import { ProgressBar } from '../common/ProgressBar'
import { formatGb } from './format'

const DISK_ROWS: { key: 'models_gb' | 'datasets_gb' | 'runs_gb' | 'exports_gb'; labelKey: string }[] = [
  { key: 'models_gb', labelKey: 'systemStats.disk.models' },
  { key: 'datasets_gb', labelKey: 'systemStats.disk.datasets' },
  { key: 'runs_gb', labelKey: 'systemStats.disk.runs' },
  { key: 'exports_gb', labelKey: 'systemStats.disk.exports' },
]

export function SystemStatsPanel() {
  const { t } = useTranslation('dashboard')
  const { data: stats, isError: statsError } = useSystemStats()
  const { data: health, isError: healthError } = useHealth()

  const memoryPct = stats ? (stats.memory.used_gb / stats.memory.total_gb) * 100 : 0
  const isHealthy = !healthError && health?.status === 'ok'

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card title={t('systemStats.memory')}>
        {stats ? (
          <ProgressBar
            value={memoryPct}
            label={`${formatGb(stats.memory.used_gb)} / ${formatGb(stats.memory.total_gb)}`}
          />
        ) : (
          <p className="text-sm text-text-muted">
            {statsError ? t('systemStats.unavailable') : t('systemStats.loading')}
          </p>
        )}
      </Card>

      <Card title={t('systemStats.diskUsage')}>
        {stats ? (
          <ul className="flex flex-col gap-1.5 text-sm text-text">
            {DISK_ROWS.map((row) => (
              <li key={row.key} className="flex items-center justify-between">
                <span className="text-text-muted">{t(row.labelKey)}</span>
                <span>{formatGb(stats.disk[row.key])}</span>
              </li>
            ))}
            <li className="mt-1 flex items-center justify-between border-t border-border pt-1.5">
              <span className="text-text-muted">{t('systemStats.disk.free')}</span>
              <span>{formatGb(stats.disk.free_gb)}</span>
            </li>
          </ul>
        ) : (
          <p className="text-sm text-text-muted">
            {statsError ? t('systemStats.unavailable') : t('systemStats.loading')}
          </p>
        )}
      </Card>

      <Card title={t('systemStats.backend')}>
        <div className="flex flex-col gap-1.5 text-sm">
          <Badge variant={isHealthy ? 'success' : 'danger'} className="w-fit">
            {isHealthy ? t('systemStats.healthy') : t('systemStats.unreachable')}
          </Badge>
          {health ? (
            <ul className="mt-1 flex flex-col gap-1 text-text-muted">
              <li>{t('systemStats.versionApp', { version: health.version })}</li>
              <li>{t('systemStats.versionMlx', { version: health.mlx_version })}</li>
              <li>{t('systemStats.versionMlxLmLora', { version: health.mlx_lm_lora_version })}</li>
            </ul>
          ) : (
            <p className="text-text-muted">
              {healthError ? t('systemStats.versionUnavailable') : t('systemStats.loading')}
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}
