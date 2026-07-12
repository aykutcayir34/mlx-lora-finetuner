import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient } from '../client'
import type { RunSummary, TrainingConfig } from '../types'
import { queryKeys } from './keys'

// docs/api.md "Run History": GET /runs/history sort whitelist.
export type HistorySort = 'created_at' | '-created_at' | 'final_train_loss' | '-final_train_loss'

export interface RunHistoryFilters {
  modelId?: string
  trainMode?: string
  status?: string
  sort?: HistorySort
  limit?: number
  offset?: number
}

export function useRunHistory(filters: RunHistoryFilters = {}) {
  const { modelId, trainMode, status, sort = '-created_at', limit = 20, offset = 0 } = filters
  return useQuery({
    queryKey: queryKeys.history.list(modelId, trainMode, status, sort, limit, offset),
    queryFn: () => {
      const params = new URLSearchParams({ sort, limit: String(limit), offset: String(offset) })
      if (modelId) params.set('model_id', modelId)
      if (trainMode) params.set('train_mode', trainMode)
      if (status) params.set('status', status)
      return apiClient.get<{ runs: RunSummary[]; total: number }>(
        `/runs/history?${params.toString()}`,
      )
    },
  })
}

export function useCloneRun() {
  return useMutation({
    mutationFn: (runId: string) =>
      apiClient.post<TrainingConfig>(`/train/jobs/${encodeURIComponent(runId)}/clone`),
  })
}
