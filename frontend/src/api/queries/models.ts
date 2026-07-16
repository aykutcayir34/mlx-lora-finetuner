import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../client'
import type { DownloadInfo, HFSearchResult, ModelInfo } from '../types'
import { queryKeys } from './keys'

export function useModels() {
  return useQuery({
    queryKey: queryKeys.models.list,
    queryFn: () => apiClient.get<{ models: ModelInfo[] }>('/models'),
    select: (data) => data.models,
  })
}

export function useModelSearch(q: string, author?: string) {
  return useQuery({
    queryKey: queryKeys.models.search(q, author),
    queryFn: () => {
      const params = new URLSearchParams({ q, limit: '20' })
      if (author) params.set('author', author)
      return apiClient.get<{ results: HFSearchResult[] }>(`/models/search?${params.toString()}`)
    },
    enabled: q.length > 0,
  })
}

export function useDownloadModel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { model_id: string }) =>
      apiClient.post<{ download_id: string; model_id: string }>('/models/download', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.models.downloads })
    },
  })
}

export function useDownloads() {
  return useQuery({
    queryKey: queryKeys.models.downloads,
    queryFn: () => apiClient.get<{ downloads: DownloadInfo[] }>('/models/downloads'),
    refetchInterval: (query) => {
      const downloads = query.state.data?.downloads ?? []
      return downloads.some((d) => d.status === 'running') ? 1500 : false
    },
  })
}

export function useCancelDownload() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (downloadId: string) =>
      apiClient.post<DownloadInfo>(`/models/downloads/${downloadId}/cancel`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.models.downloads })
    },
  })
}

export function useDeleteModel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (modelId: string) =>
      apiClient.delete<void>(`/models/${encodeURIComponent(modelId)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.models.list })
      // Deleting frees disk space — refresh the footer/dashboard stats now
      // instead of waiting for the next poll.
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
    },
  })
}
