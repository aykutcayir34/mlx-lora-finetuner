import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../client'
import type { AdapterInfo } from '../types'
import { queryKeys } from './keys'

export function useAdapters() {
  return useQuery({
    queryKey: queryKeys.adapters.list,
    queryFn: () => apiClient.get<{ adapters: AdapterInfo[] }>('/adapters'),
  })
}
