import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../client'
import type { MetricEvent, RunSummary, TrainingConfig } from '../types'
import { queryKeys } from './keys'

const TRAINING_RUNS_PREFIX = ['training', 'runs'] as const

export function useRuns(status?: string, limit = 50, offset = 0) {
  return useQuery({
    queryKey: queryKeys.training.runs(status, limit, offset),
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
      if (status) params.set('status', status)
      return apiClient.get<{ runs: RunSummary[]; total: number }>(
        `/train/jobs?${params.toString()}`,
      )
    },
  })
}

export function useRun(runId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.training.run(runId ?? ''),
    queryFn: () => apiClient.get<RunSummary>(`/train/jobs/${encodeURIComponent(runId ?? '')}`),
    enabled: !!runId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'running' || status === 'queued' ? 2000 : false
    },
  })
}

export function useCreateRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: TrainingConfig) => apiClient.post<RunSummary>('/train/jobs', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TRAINING_RUNS_PREFIX })
    },
  })
}

export function useCancelRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (runId: string) =>
      apiClient.post<RunSummary>(`/train/jobs/${encodeURIComponent(runId)}/cancel`),
    onSuccess: (_data, runId) => {
      queryClient.invalidateQueries({ queryKey: TRAINING_RUNS_PREFIX })
      queryClient.invalidateQueries({ queryKey: queryKeys.training.run(runId) })
    },
  })
}

export function useRunMetrics(runId: string, afterStep = 0, kind?: 'train' | 'val') {
  return useQuery({
    queryKey: queryKeys.training.metrics(runId, afterStep, kind),
    queryFn: () => {
      const params = new URLSearchParams({ after_step: String(afterStep) })
      if (kind) params.set('kind', kind)
      return apiClient.get<{ metrics: MetricEvent[] }>(
        `/train/jobs/${encodeURIComponent(runId)}/metrics?${params.toString()}`,
      )
    },
    enabled: !!runId,
  })
}

export function useRunLogs(runId: string, tail = 200) {
  return useQuery({
    queryKey: queryKeys.training.logs(runId, tail),
    queryFn: () => {
      const params = new URLSearchParams({ tail: String(tail) })
      return apiClient.get<{ lines: string[] }>(
        `/train/jobs/${encodeURIComponent(runId)}/logs?${params.toString()}`,
      )
    },
    enabled: !!runId,
  })
}
