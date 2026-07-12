import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../client'
import type { DatasetInfo, PreviewPage, PreviewSplit, SplitRequest, ValidationReport } from '../types'
import { queryKeys } from './keys'

export function useDatasets() {
  return useQuery({
    queryKey: queryKeys.datasets.list,
    queryFn: () => apiClient.get<{ datasets: DatasetInfo[] }>('/datasets'),
  })
}

export function useUploadDataset() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ file, name }: { file: File; name?: string }) => {
      const formData = new FormData()
      formData.set('file', file)
      if (name) formData.set('name', name)
      return apiClient.post<DatasetInfo>('/datasets/upload', formData)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.datasets.list })
    },
  })
}

export function useValidateDataset() {
  return useMutation({
    mutationFn: (datasetId: string) =>
      apiClient.post<ValidationReport>(`/datasets/${encodeURIComponent(datasetId)}/validate`),
  })
}

export function useSplitDataset() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ datasetId, body }: { datasetId: string; body: SplitRequest }) =>
      apiClient.post<DatasetInfo>(`/datasets/${encodeURIComponent(datasetId)}/split`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.datasets.list })
    },
  })
}

export function useDatasetPreview(
  datasetId: string,
  split: PreviewSplit,
  page = 1,
  size = 20,
) {
  return useQuery({
    queryKey: queryKeys.datasets.preview(datasetId, split, page, size),
    queryFn: () => {
      const params = new URLSearchParams({
        split,
        page: String(page),
        size: String(size),
      })
      return apiClient.get<PreviewPage>(
        `/datasets/${encodeURIComponent(datasetId)}/preview?${params.toString()}`,
      )
    },
    enabled: !!datasetId,
  })
}

export function useDeleteDataset() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (datasetId: string) =>
      apiClient.delete<void>(`/datasets/${encodeURIComponent(datasetId)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.datasets.list })
    },
  })
}
