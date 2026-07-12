import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient } from '../client'
import type {
  ExportArtifact,
  ExportJobInfo,
  FuseRequest,
  GGUFRequest,
  OllamaModelfileRequest,
  PreflightReport,
} from '../types'
import { queryKeys } from './keys'

export function useFuse() {
  return useMutation({
    mutationFn: (body: FuseRequest) =>
      apiClient.post<{ export_id: string; kind: 'fuse' }>('/export/fuse', body),
  })
}

export function useGguf() {
  return useMutation({
    mutationFn: (body: GGUFRequest) =>
      apiClient.post<{ export_id: string; kind: 'gguf' }>('/export/gguf', body),
  })
}

export function useGgufPreflight(modelPath: string) {
  return useQuery({
    queryKey: queryKeys.export.preflight(modelPath),
    queryFn: () => {
      const params = new URLSearchParams({ model_path: modelPath })
      return apiClient.get<PreflightReport>(`/export/gguf/preflight?${params.toString()}`)
    },
    enabled: !!modelPath,
  })
}

export function useOllamaModelfile() {
  return useMutation({
    mutationFn: (body: OllamaModelfileRequest) =>
      apiClient.post<{ modelfile: string; path: string }>('/export/ollama-modelfile', body),
  })
}

export function useExportJob(exportId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.export.job(exportId ?? ''),
    queryFn: () => apiClient.get<ExportJobInfo>(`/export/jobs/${encodeURIComponent(exportId ?? '')}`),
    enabled: !!exportId,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 1500 : false),
  })
}

export function useArtifacts() {
  return useQuery({
    queryKey: queryKeys.export.artifacts,
    queryFn: () => apiClient.get<{ artifacts: ExportArtifact[] }>('/export/artifacts'),
  })
}
