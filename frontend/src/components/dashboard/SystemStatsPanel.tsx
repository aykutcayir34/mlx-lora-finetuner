import { useHealth, useSystemStats } from '../../api/queries/system'
import { Badge } from '../common/Badge'
import { Card } from '../common/Card'
import { ProgressBar } from '../common/ProgressBar'
import { formatGb } from './format'

const DISK_ROWS: { key: 'models_gb' | 'datasets_gb' | 'runs_gb' | 'exports_gb'; label: string }[] = [
  { key: 'models_gb', label: 'Modeller' },
  { key: 'datasets_gb', label: 'Datasetler' },
  { key: 'runs_gb', label: 'Eğitimler' },
  { key: 'exports_gb', label: 'Export' },
]

export function SystemStatsPanel() {
  const { data: stats, isError: statsError } = useSystemStats()
  const { data: health, isError: healthError } = useHealth()

  const memoryPct = stats ? (stats.memory.used_gb / stats.memory.total_gb) * 100 : 0
  const isHealthy = !healthError && health?.status === 'ok'

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card title="Bellek">
        {stats ? (
          <ProgressBar
            value={memoryPct}
            label={`${formatGb(stats.memory.used_gb)} / ${formatGb(stats.memory.total_gb)}`}
          />
        ) : (
          <p className="text-sm text-text-muted">{statsError ? 'Kullanılamıyor' : 'Yükleniyor…'}</p>
        )}
      </Card>

      <Card title="Disk kullanımı">
        {stats ? (
          <ul className="flex flex-col gap-1.5 text-sm text-text">
            {DISK_ROWS.map((row) => (
              <li key={row.key} className="flex items-center justify-between">
                <span className="text-text-muted">{row.label}</span>
                <span>{formatGb(stats.disk[row.key])}</span>
              </li>
            ))}
            <li className="mt-1 flex items-center justify-between border-t border-border pt-1.5">
              <span className="text-text-muted">Boş alan</span>
              <span>{formatGb(stats.disk.free_gb)}</span>
            </li>
          </ul>
        ) : (
          <p className="text-sm text-text-muted">{statsError ? 'Kullanılamıyor' : 'Yükleniyor…'}</p>
        )}
      </Card>

      <Card title="Backend">
        <div className="flex flex-col gap-1.5 text-sm">
          <Badge variant={isHealthy ? 'success' : 'danger'} className="w-fit">
            {isHealthy ? 'Sağlıklı' : 'Erişilemiyor'}
          </Badge>
          {health ? (
            <ul className="mt-1 flex flex-col gap-1 text-text-muted">
              <li>App: {health.version}</li>
              <li>mlx: {health.mlx_version}</li>
              <li>mlx-lm-lora: {health.mlx_lm_lora_version}</li>
            </ul>
          ) : (
            <p className="text-text-muted">
              {healthError ? 'Sürüm bilgisi alınamadı' : 'Yükleniyor…'}
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}
