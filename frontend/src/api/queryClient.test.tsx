import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server'
import { useModels } from './queries/models'
import { ApiError } from './client'
import { createQueryClient, shouldRetryQuery } from './queryClient'

/** Renders with the PRODUCTION query-client defaults, not the test client. */
function renderWithProductionClient(ui: ReactNode) {
  const queryClient = createQueryClient()
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function ModelsProbe() {
  const models = useModels()
  if (models.isError) return <p>models failed to load</p>
  return <p>{models.data ? `${models.data.length} models` : 'loading'}</p>
}

describe('createQueryClient retry policy', () => {
  it('does not retry a 404 ApiError — exactly one request, error state still surfaces', async () => {
    let requests = 0
    server.use(
      http.get('/api/v1/models', () => {
        requests += 1
        return HttpResponse.json(
          { error: { code: 'not_found', message: 'nope', detail: {} } },
          { status: 404 },
        )
      }),
    )

    renderWithProductionClient(<ModelsProbe />)

    expect(await screen.findByText('models failed to load')).toBeInTheDocument()
    // Give any (buggy) retry a chance to fire before counting.
    await new Promise((resolve) => setTimeout(resolve, 50))
    await waitFor(() => expect(requests).toBe(1))
  })

  it('does not retry a 422 ApiError either', async () => {
    let requests = 0
    server.use(
      http.get('/api/v1/models', () => {
        requests += 1
        return HttpResponse.json(
          { error: { code: 'validation_error', message: 'bad input', detail: {} } },
          { status: 422 },
        )
      }),
    )

    renderWithProductionClient(<ModelsProbe />)

    expect(await screen.findByText('models failed to load')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(requests).toBe(1)
  })

  it('shouldRetryQuery retries only non-ApiError failures, at most twice', () => {
    const apiError = new ApiError('internal', 'boom', {})
    const networkError = new TypeError('Failed to fetch')

    expect(shouldRetryQuery(0, apiError)).toBe(false)
    expect(shouldRetryQuery(1, apiError)).toBe(false)

    expect(shouldRetryQuery(0, networkError)).toBe(true)
    expect(shouldRetryQuery(1, networkError)).toBe(true)
    expect(shouldRetryQuery(2, networkError)).toBe(false)
  })
})
