import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './client'

const MAX_RETRIES = 2

/**
 * Retry policy for all queries: an ApiError means the backend answered with
 * an HTTP error envelope — retrying will not change the outcome (ApiError
 * carries no reliable status, so 4xx and 5xx are treated alike). Only
 * transport-level failures (fetch TypeError etc.) are retried, at most twice.
 * Individual queries can still override with their own `retry` option
 * (e.g. useHealth/useSystemStats set `retry: false`).
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) return false
  return failureCount < MAX_RETRIES
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetryQuery,
        staleTime: 5_000,
        refetchOnWindowFocus: false,
      },
    },
  })
}
