import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../client'
import type {
  DatasetImportInfo,
  DatasetImportRequest,
  DatasetImportResponse,
  DatasetInfo,
  HFDatasetSearchResult,
  PreviewPage,
  PreviewSplit,
  SplitRequest,
  ValidationReport,
} from '../types'
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
      // Deleting frees disk space — refresh the footer/dashboard stats now
      // instead of waiting for the next poll.
      queryClient.invalidateQueries({ queryKey: queryKeys.stats })
    },
  })
}

export function useDatasetSearch(query: string) {
  return useQuery({
    queryKey: queryKeys.datasets.search(query),
    queryFn: () => {
      const params = new URLSearchParams({ q: query, limit: '20' })
      return apiClient.get<{ results: HFDatasetSearchResult[] }>(
        `/datasets/search?${params.toString()}`,
      )
    },
    enabled: query.length > 0,
  })
}

export function useImportDataset() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: DatasetImportRequest) =>
      apiClient.post<DatasetImportResponse>('/datasets/import', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.datasets.imports })
    },
  })
}

export function useDatasetImports() {
  return useQuery({
    queryKey: queryKeys.datasets.imports,
    queryFn: () => apiClient.get<{ imports: DatasetImportInfo[] }>('/datasets/imports'),
    refetchInterval: (query) => {
      const imports = query.state.data?.imports ?? []
      return imports.some((item) => item.status === 'running') ? 1500 : false
    },
  })
}

export function useCancelImport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (importId: string) =>
      apiClient.post<DatasetImportInfo>(`/datasets/imports/${encodeURIComponent(importId)}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.datasets.imports })
    },
  })
}
