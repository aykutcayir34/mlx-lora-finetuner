import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../api/client'
import type { HealthInfo } from '../../api/types'

const HEALTH_POLL_MS = 5000

export function TopBar() {
  const { data, isError } = useQuery({
    queryKey: ['system', 'health'],
    queryFn: () => apiClient.get<HealthInfo>('/system/health'),
    refetchInterval: HEALTH_POLL_MS,
    retry: false,
  })

  const isHealthy = !isError && data?.status === 'ok'
  const dotClass = isHealthy ? 'bg-success' : 'bg-danger'
  const label = isHealthy ? 'Backend healthy' : 'Backend unreachable'

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4">
      <span className="font-semibold tracking-tight text-text">MLX LoRA Finetuner</span>
      <div className="flex items-center gap-2 text-sm text-text-muted" title={label}>
        <span
          data-testid="health-dot"
          aria-label={label}
          className={`h-2.5 w-2.5 rounded-full ${dotClass}`}
        />
        <span>{label}</span>
      </div>
    </header>
  )
}
