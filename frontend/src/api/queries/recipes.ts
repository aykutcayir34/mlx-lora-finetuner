import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient } from '../client'
import type { RecipeConvertResponse, RecipeJobInfo, RecipeOutputFormat } from '../types'
import { queryKeys } from './keys'

export interface RecipeConvertRequest {
  file: File
  name: string
  output_format: RecipeOutputFormat
  chunk_size?: number
  chunk_overlap?: number
  prompt_column?: string
  completion_column?: string
  system_prompt?: string
}

// Note: the produced dataset only exists once the background job completes,
// so the datasets-list cache is invalidated by the caller when the polled
// job settles as "completed" (see RecipeJobProgress), not here on submit.
export function useConvertRecipe() {
  return useMutation({
    mutationFn: (body: RecipeConvertRequest) => {
      const formData = new FormData()
      formData.set('file', body.file)
      formData.set('name', body.name)
      formData.set('output_format', body.output_format)
      if (body.chunk_size !== undefined) formData.set('chunk_size', String(body.chunk_size))
      if (body.chunk_overlap !== undefined) {
        formData.set('chunk_overlap', String(body.chunk_overlap))
      }
      if (body.prompt_column) formData.set('prompt_column', body.prompt_column)
      if (body.completion_column) formData.set('completion_column', body.completion_column)
      if (body.system_prompt) formData.set('system_prompt', body.system_prompt)
      return apiClient.post<RecipeConvertResponse>('/recipes/convert', formData)
    },
  })
}

export function useRecipeJob(jobId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.recipes.job(jobId ?? ''),
    queryFn: () =>
      apiClient.get<RecipeJobInfo>(`/recipes/jobs/${encodeURIComponent(jobId ?? '')}`),
    enabled: !!jobId,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 1500 : false),
  })
}
