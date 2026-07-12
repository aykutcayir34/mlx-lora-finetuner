import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../client'
import type { HealthInfo, SystemStats } from '../types'
import { queryKeys } from './keys'

const STATS_POLL_MS = 5000

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => apiClient.get<HealthInfo>('/system/health'),
    retry: false,
  })
}

export function useSystemStats() {
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: () => apiClient.get<SystemStats>('/system/stats'),
    refetchInterval: STATS_POLL_MS,
    retry: false,
  })
}
